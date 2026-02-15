import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ApiResponse } from '../core/types';

interface QuarterlySalesReportRow {
  id: string;
  organizationId: string;
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
  imports: [CommonModule, FormsModule],
  templateUrl: './reports-page.component.html',
})
export class ReportsPageComponent {
  private readonly api: ApiService;
  private readonly auth: AuthService;

  constructor(api: ApiService, auth: AuthService) {
    this.api = api;
    this.auth = auth;
  }

  readonly salesRows = signal<QuarterlySalesReportRow[]>([]);
  readonly latestSalesReport = signal<QuarterlySalesReportRow | null>(null);
  readonly loadingSales = signal(false);
  readonly generatingSales = signal(false);
  readonly salesError = signal('');
  readonly salesMessage = signal('');

  readonly expenseRows = signal<QuarterlyExpenseReportRow[]>([]);
  readonly latestExpenseReport = signal<QuarterlyExpenseReportRow | null>(null);
  readonly loadingExpenses = signal(false);
  readonly generatingExpenses = signal(false);
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

  readonly availableYears = computed(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 8 }, (_, index) => currentYear - index);
  });

  get currentOrganizationCurrency(): string {
    return String(this.auth.currentUser()?.currency || 'USD').toUpperCase();
  }

  ngOnInit(): void {
    this.loadSalesReports();
    this.loadExpenseReports();
  }

  loadSalesReports(): void {
    this.loadingSales.set(true);
    this.salesError.set('');

    const params = new URLSearchParams({
      page: String(this.salesPage),
      limit: String(this.salesPageSize),
      year: String(this.selectedYear()),
      quarter: String(this.selectedQuarter()),
    });

    this.api.list<QuarterlySalesReportRow>(`/api/v1/reports/quarterly-sales?${params.toString()}`).subscribe({
      next: (response: ApiResponse<QuarterlySalesReportRow[]>) => {
        this.loadingSales.set(false);
        const rows = response.data || [];
        this.salesRows.set(rows);
        this.latestSalesReport.set(rows[0] || null);

        const meta = response.meta || {};
        this.salesTotal = Number(meta.total || 0);
        this.salesTotalPages = Math.max(1, Number(meta.totalPages || 1));
        this.salesPage = Math.max(1, Number(meta.page || this.salesPage));
        this.salesPageSize = Math.max(1, Number(meta.limit || this.salesPageSize));
      },
      error: (err) => {
        this.loadingSales.set(false);
        this.salesError.set(err?.error?.message || 'Unable to load sales reports.');
      },
    });
  }

  loadExpenseReports(): void {
    this.loadingExpenses.set(true);
    this.expenseError.set('');

    const params = new URLSearchParams({
      page: String(this.expensePage),
      limit: String(this.expensePageSize),
      year: String(this.selectedYear()),
      quarter: String(this.selectedQuarter()),
    });

    this.api.list<QuarterlyExpenseReportRow>(`/api/v1/reports/quarterly-expenses?${params.toString()}`).subscribe({
      next: (response: ApiResponse<QuarterlyExpenseReportRow[]>) => {
        this.loadingExpenses.set(false);
        const rows = response.data || [];
        this.expenseRows.set(rows);
        this.latestExpenseReport.set(rows[0] || null);

        const meta = response.meta || {};
        this.expenseTotal = Number(meta.total || 0);
        this.expenseTotalPages = Math.max(1, Number(meta.totalPages || 1));
        this.expensePage = Math.max(1, Number(meta.page || this.expensePage));
        this.expensePageSize = Math.max(1, Number(meta.limit || this.expensePageSize));
      },
      error: (err) => {
        this.loadingExpenses.set(false);
        this.expenseError.set(err?.error?.message || 'Unable to load expense reports.');
      },
    });
  }

  generateQuarterlySalesReport(): void {
    this.generatingSales.set(true);
    this.salesError.set('');
    this.salesMessage.set('');

    const payload = {
      year: this.selectedYear(),
      quarter: this.selectedQuarter(),
      currency: this.currentOrganizationCurrency,
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
    this.generatingExpenses.set(true);
    this.expenseError.set('');
    this.expenseMessage.set('');

    const payload = {
      year: this.selectedYear(),
      quarter: this.selectedQuarter(),
      currency: this.currentOrganizationCurrency,
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
    this.salesPage = 1;
    this.expensePage = 1;
    this.loadSalesReports();
    this.loadExpenseReports();
  }

  onSalesPageSizeChange(value: string): void {
    const parsed = Number(value);
    this.salesPageSize = Number.isFinite(parsed) ? parsed : 20;
    this.salesPage = 1;
    this.loadSalesReports();
  }

  onExpensePageSizeChange(value: string): void {
    const parsed = Number(value);
    this.expensePageSize = Number.isFinite(parsed) ? parsed : 20;
    this.expensePage = 1;
    this.loadExpenseReports();
  }

  goToSalesPage(page: number): void {
    if (page < 1 || page > this.salesTotalPages || page === this.salesPage || this.loadingSales()) {
      return;
    }
    this.salesPage = page;
    this.loadSalesReports();
  }

  goToExpensePage(page: number): void {
    if (page < 1 || page > this.expenseTotalPages || page === this.expensePage || this.loadingExpenses()) {
      return;
    }
    this.expensePage = page;
    this.loadExpenseReports();
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
}
