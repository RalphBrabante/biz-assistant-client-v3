import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ConfirmDialogService } from '../core/confirm-dialog.service';
import { OrganizationContextService } from '../core/organization-context.service';
import { ApiResponse } from '../core/types';
import { loadTablePreferences, saveTablePreferences, toPositiveInt, toTableViewMode, TableViewMode } from '../core/table-preferences';

interface QuarterlySalesReportRow {
  id: string;
  organizationId: string;
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
  year: number;
  quarter: number;
  periodStart: string;
  periodEnd: string;
  invoiceCount: number;
  currency: string;
  subtotalAmount: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  generatedAt: string;
}

interface QuarterlyExpenseReportRow {
  id: string;
  organizationId: string;
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
  year: number;
  quarter: number;
  periodStart: string;
  periodEnd: string;
  expenseCount: number;
  currency: string;
  amount: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  generatedAt: string;
}

@Component({
  selector: 'app-reports-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './reports-page.component.html',
})
export class ReportsPageComponent {
  private readonly api: ApiService;
  private readonly auth: AuthService;
  private readonly confirmDialog: ConfirmDialogService;
  private readonly organizationContext: OrganizationContextService;

  constructor(api: ApiService, auth: AuthService, confirmDialog: ConfirmDialogService, organizationContext: OrganizationContextService) {
    this.api = api;
    this.auth = auth;
    this.confirmDialog = confirmDialog;
    this.organizationContext = organizationContext;
  }

  readonly salesRows = signal<QuarterlySalesReportRow[]>([]);
  readonly latestSalesReport = signal<QuarterlySalesReportRow | null>(null);
  readonly loadingSales = signal(false);
  readonly generatingSales = signal(false);
  readonly deletingSalesReportId = signal('');
  readonly salesError = signal('');
  readonly salesMessage = signal('');

  readonly expenseRows = signal<QuarterlyExpenseReportRow[]>([]);
  readonly latestExpenseReport = signal<QuarterlyExpenseReportRow | null>(null);
  readonly loadingExpenses = signal(false);
  readonly generatingExpenses = signal(false);
  readonly deletingExpenseReportId = signal('');
  readonly expenseError = signal('');
  readonly expenseMessage = signal('');

  readonly selectedYear = signal(new Date().getFullYear());
  readonly selectedQuarter = signal(this.getCurrentQuarter());

  salesPage = 1;
  salesPageSize = 20;
  salesTotal = 0;
  salesTotalPages = 1;

  expensePage = 1;
  expensePageSize = 20;
  expenseTotal = 0;
  expenseTotalPages = 1;

  readonly pageSizeOptions = [10, 20, 50, 100];
  viewMode: TableViewMode = 'table';
  private readonly tablePrefsKey = 'reports-page';
  private readonly organizationNameMap = signal<Record<string, string>>({});

  readonly availableYears = computed(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 8 }, (_, index) => currentYear - index);
  });

  get currentOrganizationCurrency(): string {
    return String(this.auth.currentUser()?.currency || 'USD').toUpperCase();
  }

  get isSuperuser(): boolean {
    const roleCodes = (this.auth.currentUser()?.roleCodes || []).map((code) =>
      String(code || '').toLowerCase()
    );
    return roleCodes.includes('superuser');
  }

  get canGenerateReports(): boolean {
    return this.auth.hasPermission('reports.generate');
  }

  get canDeleteReports(): boolean {
    return this.auth.hasPermission('reports.delete');
  }

  get hasOrganizationContext(): boolean {
    return Boolean(this.organizationContext.getActiveOrganizationId().trim());
  }

  get isContextLocked(): boolean {
    return this.isSuperuser && !this.hasOrganizationContext;
  }

  showOrganizationWarningModal = false;

  private get orgParamValue(): string {
    const organizationId = this.organizationContext.getActiveOrganizationId();
    if (!organizationId) {
      return '';
    }
    if (this.isSuperuser && !this.organizationContext.shouldApplySuperuserScope()) {
      return '';
    }
    return organizationId;
  }

  ngOnInit(): void {
    this.restoreTablePreferences();
    this.showOrganizationWarningModal = this.isContextLocked;
    if (this.isSuperuser) {
      this.loadOrganizations();
    }
    this.loadSalesReports();
    this.loadExpenseReports();
  }

  closeOrganizationWarningModal(): void {
    this.showOrganizationWarningModal = false;
  }

  private loadOrganizations(): void {
    this.api.list<{ id: string; name?: string; legalName?: string }>('/api/v1/organizations?limit=500').subscribe({
      next: (response) => {
        const map: Record<string, string> = {};
        for (const org of response.data || []) {
          const id = String(org.id || '').trim();
          if (!id) continue;
          map[id] = String(org.name || org.legalName || id).trim() || id;
        }
        this.organizationNameMap.set(map);
      },
      error: () => {
        this.organizationNameMap.set({});
      },
    });
  }

  organizationLabelById(organizationId: string): string {
    const id = String(organizationId || '').trim();
    if (!id) {
      return '-';
    }
    return this.organizationNameMap()[id] || id;
  }

  loadSalesReports(): void {
    if (this.isContextLocked) {
      this.loadingSales.set(false);
      this.salesRows.set([]);
      this.latestSalesReport.set(null);
      this.salesTotal = 0;
      this.salesTotalPages = 1;
      this.salesPage = 1;
      this.salesError.set('');
      return;
    }
    this.loadingSales.set(true);
    this.salesError.set('');

    const params = new URLSearchParams({
      page: String(this.salesPage),
      limit: String(this.salesPageSize),
    });
    if (this.orgParamValue) {
      params.set('organizationId', this.orgParamValue);
    }

    this.api.list<QuarterlySalesReportRow>(`/api/v1/reports/quarterly-sales?${params.toString()}`).subscribe({
      next: (response: ApiResponse<QuarterlySalesReportRow[]>) => {
        this.loadingSales.set(false);
        const rows = (response.data || []).filter((row) =>
          this.isSuperuser || row.organizationId === this.orgParamValue
        );
        this.salesRows.set(rows);
        this.latestSalesReport.set(this.findSelectedSalesReport(rows));

        const meta = response.meta || {};
        this.salesTotal = Number(meta.total || 0);
        this.salesTotalPages = Math.max(1, Number(meta.totalPages || 1));
        this.salesPage = Math.max(1, Number(meta.page || this.salesPage));
        this.salesPageSize = Math.max(1, Number(meta.limit || this.salesPageSize));
        this.persistTablePreferences();
      },
      error: (err) => {
        this.loadingSales.set(false);
        this.salesError.set(err?.error?.message || 'Unable to load sales reports.');
      },
    });
  }

  loadExpenseReports(): void {
    if (this.isContextLocked) {
      this.loadingExpenses.set(false);
      this.expenseRows.set([]);
      this.latestExpenseReport.set(null);
      this.expenseTotal = 0;
      this.expenseTotalPages = 1;
      this.expensePage = 1;
      this.expenseError.set('');
      return;
    }
    this.loadingExpenses.set(true);
    this.expenseError.set('');

    const params = new URLSearchParams({
      page: String(this.expensePage),
      limit: String(this.expensePageSize),
    });
    if (this.orgParamValue) {
      params.set('organizationId', this.orgParamValue);
    }

    this.api.list<QuarterlyExpenseReportRow>(`/api/v1/reports/quarterly-expenses?${params.toString()}`).subscribe({
      next: (response: ApiResponse<QuarterlyExpenseReportRow[]>) => {
        this.loadingExpenses.set(false);
        const rows = (response.data || []).filter((row) =>
          this.isSuperuser || row.organizationId === this.orgParamValue
        );
        this.expenseRows.set(rows);
        this.latestExpenseReport.set(this.findSelectedExpenseReport(rows));

        const meta = response.meta || {};
        this.expenseTotal = Number(meta.total || 0);
        this.expenseTotalPages = Math.max(1, Number(meta.totalPages || 1));
        this.expensePage = Math.max(1, Number(meta.page || this.expensePage));
        this.expensePageSize = Math.max(1, Number(meta.limit || this.expensePageSize));
        this.persistTablePreferences();
      },
      error: (err) => {
        this.loadingExpenses.set(false);
        this.expenseError.set(err?.error?.message || 'Unable to load expense reports.');
      },
    });
  }

  generateQuarterlySalesReport(): void {
    if (this.isContextLocked) return;
    this.generatingSales.set(true);
    this.salesError.set('');
    this.salesMessage.set('');

    const payload = {
      year: this.selectedYear(),
      quarter: this.selectedQuarter(),
      currency: this.currentOrganizationCurrency,
      ...(this.orgParamValue ? { organizationId: this.orgParamValue } : {}),
    };

    this.api.create<QuarterlySalesReportRow>('/api/v1/reports/quarterly-sales', payload).subscribe({
      next: (response) => {
        this.generatingSales.set(false);
        this.salesMessage.set(response.message || 'Quarterly sales report generated successfully.');
        if (response.data) {
          this.latestSalesReport.set(response.data);
        }
        this.salesPage = 1;
        this.loadSalesReports();
      },
      error: (err) => {
        this.generatingSales.set(false);
        this.salesError.set(err?.error?.message || 'Unable to generate sales report.');
      },
    });
  }

  generateQuarterlyExpenseReport(): void {
    if (this.isContextLocked) return;
    this.generatingExpenses.set(true);
    this.expenseError.set('');
    this.expenseMessage.set('');

    const payload = {
      year: this.selectedYear(),
      quarter: this.selectedQuarter(),
      currency: this.currentOrganizationCurrency,
      ...(this.orgParamValue ? { organizationId: this.orgParamValue } : {}),
    };

    this.api.create<QuarterlyExpenseReportRow>('/api/v1/reports/quarterly-expenses', payload).subscribe({
      next: (response) => {
        this.generatingExpenses.set(false);
        this.expenseMessage.set(response.message || 'Quarterly expense report generated successfully.');
        if (response.data) {
          this.latestExpenseReport.set(response.data);
        }
        this.expensePage = 1;
        this.loadExpenseReports();
      },
      error: (err) => {
        this.generatingExpenses.set(false);
        this.expenseError.set(err?.error?.message || 'Unable to generate expense report.');
      },
    });
  }

  onFilterChange(): void {
    if (this.isContextLocked) return;
    this.salesPage = 1;
    this.expensePage = 1;
    this.persistTablePreferences();
    this.loadSalesReports();
    this.loadExpenseReports();
  }

  onSalesPageSizeChange(value: string): void {
    if (this.isContextLocked) return;
    const parsed = Number(value);
    this.salesPageSize = Number.isFinite(parsed) ? parsed : 20;
    this.salesPage = 1;
    this.persistTablePreferences();
    this.loadSalesReports();
  }

  onExpensePageSizeChange(value: string): void {
    if (this.isContextLocked) return;
    const parsed = Number(value);
    this.expensePageSize = Number.isFinite(parsed) ? parsed : 20;
    this.expensePage = 1;
    this.persistTablePreferences();
    this.loadExpenseReports();
  }

  setViewMode(mode: TableViewMode): void {
    if (this.isContextLocked) return;
    this.viewMode = mode;
    this.persistTablePreferences();
  }

  goToSalesPage(page: number): void {
    if (this.isContextLocked || page < 1 || page > this.salesTotalPages || page === this.salesPage || this.loadingSales()) {
      return;
    }
    this.salesPage = page;
    this.persistTablePreferences();
    this.loadSalesReports();
  }

  goToExpensePage(page: number): void {
    if (this.isContextLocked || page < 1 || page > this.expenseTotalPages || page === this.expensePage || this.loadingExpenses()) {
      return;
    }
    this.expensePage = page;
    this.persistTablePreferences();
    this.loadExpenseReports();
  }

  async deleteSalesReport(id: string): Promise<void> {
    if (this.isContextLocked) return;
    const reportId = String(id || '').trim();
    if (!reportId) {
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Sales Report',
      message: 'Delete this quarterly sales report? This action cannot be undone.',
      confirmText: 'Delete Report',
      confirmButtonClass: 'btn-danger',
      iconClass: 'bi-trash3',
    });
    if (!confirmed) {
      return;
    }

    this.deletingSalesReportId.set(reportId);
    this.salesError.set('');
    this.salesMessage.set('');
    this.api.remove('/api/v1/reports/quarterly-sales', reportId).subscribe({
      next: (response) => {
        this.deletingSalesReportId.set('');
        this.salesMessage.set(response.message || 'Quarterly sales report deleted successfully.');
        this.loadSalesReports();
      },
      error: (err) => {
        this.deletingSalesReportId.set('');
        this.salesError.set(err?.error?.message || 'Unable to delete sales report.');
      },
    });
  }

  async deleteExpenseReport(id: string): Promise<void> {
    if (this.isContextLocked) return;
    const reportId = String(id || '').trim();
    if (!reportId) {
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Expense Report',
      message: 'Delete this quarterly expense report? This action cannot be undone.',
      confirmText: 'Delete Report',
      confirmButtonClass: 'btn-danger',
      iconClass: 'bi-trash3',
    });
    if (!confirmed) {
      return;
    }

    this.deletingExpenseReportId.set(reportId);
    this.expenseError.set('');
    this.expenseMessage.set('');
    this.api.remove('/api/v1/reports/quarterly-expenses', reportId).subscribe({
      next: (response) => {
        this.deletingExpenseReportId.set('');
        this.expenseMessage.set(response.message || 'Quarterly expense report deleted successfully.');
        this.loadExpenseReports();
      },
      error: (err) => {
        this.deletingExpenseReportId.set('');
        this.expenseError.set(err?.error?.message || 'Unable to delete expense report.');
      },
    });
  }

  quarterLabel(quarter: number): string {
    return `Q${quarter}`;
  }

  trackById(_index: number, row: { id: string }): string {
    return row.id;
  }

  toCurrency(value: number | string | null | undefined, currency = 'USD'): string {
    const numeric = Number(value || 0);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(numeric) ? numeric : 0);
  }

  private getCurrentQuarter(): number {
    return Math.floor(new Date().getMonth() / 3) + 1;
  }

  private findSelectedSalesReport(rows: QuarterlySalesReportRow[]): QuarterlySalesReportRow | null {
    return (
      rows.find(
        (row) => Number(row.year) === this.selectedYear() && Number(row.quarter) === this.selectedQuarter()
      ) || null
    );
  }

  private findSelectedExpenseReport(rows: QuarterlyExpenseReportRow[]): QuarterlyExpenseReportRow | null {
    return (
      rows.find(
        (row) => Number(row.year) === this.selectedYear() && Number(row.quarter) === this.selectedQuarter()
      ) || null
    );
  }

  private restoreTablePreferences(): void {
    const prefs = loadTablePreferences(this.tablePrefsKey);
    this.viewMode = toTableViewMode(prefs['viewMode'], this.viewMode);
    this.salesPage = toPositiveInt(prefs['salesPage'], this.salesPage);
    this.salesPageSize = toPositiveInt(prefs['salesPageSize'], this.salesPageSize);
    this.expensePage = toPositiveInt(prefs['expensePage'], this.expensePage);
    this.expensePageSize = toPositiveInt(prefs['expensePageSize'], this.expensePageSize);
  }

  private persistTablePreferences(): void {
    saveTablePreferences(this.tablePrefsKey, {
      viewMode: this.viewMode,
      salesPage: this.salesPage,
      salesPageSize: this.salesPageSize,
      expensePage: this.expensePage,
      expensePageSize: this.expensePageSize,
    });
  }
}
