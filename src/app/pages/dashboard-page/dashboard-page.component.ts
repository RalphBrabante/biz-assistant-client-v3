import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  ElementRef,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ApiResponse } from '../../core/types';
import { catchError, forkJoin, map, of } from 'rxjs';
import { Chart, registerables, TooltipItem } from 'chart.js';

Chart.register(...registerables);

interface DashboardMetrics {
  totalItems: number | null;
  totalCustomers: number | null;
  totalOrders: number | null;
  totalUsers: number | null;
  totalOrganizations: number | null;
  totalLicenses: number | null;
  totalSalesInvoices: number | null;
}

interface SalesInvoiceDashboardRow {
  issueDate?: string;
  totalAmount?: number;
  currency?: string;
}

interface ExpenseDashboardRow {
  expenseDate?: string;
  totalAmount?: number;
  currency?: string;
}

interface MonthlyDataPoint {
  month: number;
  monthName: string;
  sales: number;
  expenses: number;
}

interface MonthlySummaryResponse {
  year: number;
  currency: string;
  totalSales: number;
  totalExpenses: number;
  months: MonthlyDataPoint[];
}

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard-page.component.html',
})
export class DashboardPageComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly organizationContext = inject(OrganizationContextService);

  @ViewChild('salesExpenseChart') salesExpenseChartRef?: ElementRef<HTMLCanvasElement>;
  private salesExpenseChart: Chart<'bar', number[], string> | null = null;

  loading = false;
  error = '';
  health: Record<string, unknown> | null = null;
  metrics: DashboardMetrics | null = null;
  orderStatusCounts: Array<{ label: string; value: number; className: string }> = [];
  orderStatusMax = 1;
  selectedYear = new Date().getFullYear();
  chartLoading = false;
  chartError = '';
  chartView: 'monthly' | 'quarterly' = 'monthly';
  yearlySalesTotal = 0;
  yearlyExpenseTotal = 0;
  readonly availableYears = Array.from({ length: 8 }, (_v, index) => new Date().getFullYear() - index);

  get canViewItems(): boolean {
    return this.auth.hasPermission('items.read');
  }

  get canViewCustomers(): boolean {
    return this.auth.hasPermission('organizations.read');
  }

  get canViewOrders(): boolean {
    return this.auth.hasPermission('orders.read');
  }

  get canViewUsers(): boolean {
    return this.auth.hasPermission('users.read');
  }

  get canViewOrganizations(): boolean {
    return this.auth.hasPermission('organizations.read');
  }

  get canViewLicenses(): boolean {
    return this.auth.hasPermission('licenses.read');
  }

  get canViewSalesInvoices(): boolean {
    return this.auth.hasPermission('sales_invoices.read');
  }

  get canViewReports(): boolean {
    return this.auth.hasPermission('reports.read');
  }

  get canViewFinancialCharts(): boolean {
    const roleCodes = (this.auth.currentUser()?.roleCodes || []).map((code) =>
      String(code || '').toLowerCase()
    );
    return (
      roleCodes.includes('superuser') ||
      roleCodes.includes('administrator') ||
      roleCodes.includes('accountant')
    );
  }

  get isSuperuser(): boolean {
    const roleCodes = (this.auth.currentUser()?.roleCodes || []).map((code) =>
      String(code || '').toLowerCase()
    );
    return roleCodes.includes('superuser');
  }

  get orgCurrency(): string {
    return this.normalizeCurrencyCode(this.auth.currentUser()?.currency || 'USD');
  }

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
    this.refresh();
  }

  ngAfterViewInit(): void {
    if (this.canViewReports && this.canViewFinancialCharts) {
      this.loadChart();
    }
  }

  ngOnDestroy(): void {
    this.destroyChart();
  }

  refresh(): void {
    this.loading = true;
    this.error = '';
    const organizationId = this.auth.currentUser()?.organizationId || '';
    const roleCodes = (this.auth.currentUser()?.roleCodes || []).map((code) =>
      String(code || '').toLowerCase()
    );
    const isSuperuser = roleCodes.includes('superuser');
    const orgParam = !isSuperuser && organizationId
      ? `&organizationId=${encodeURIComponent(organizationId)}`
      : '';
    const orgOnlyQuery = !isSuperuser && organizationId
      ? `?organizationId=${encodeURIComponent(organizationId)}&limit=1`
      : '?limit=1';

    forkJoin({
      health: this.api.get<Record<string, unknown>>('/api/v1/health').pipe(
        map((response) => response.data || null),
        catchError(() => of(null))
      ),
      totalItems: this.canViewItems ? this.fetchTotal(`/api/v1/items?limit=1${orgParam}`) : of(null),
      totalCustomers: this.canViewCustomers ? this.fetchTotal(`/api/v1/customers?limit=1${orgParam}`) : of(null),
      totalOrders: this.canViewOrders ? this.fetchTotal(`/api/v1/orders?limit=1${orgParam}`) : of(null),
      totalUsers: this.canViewUsers ? this.fetchTotal(`/api/v1/users?limit=1${orgParam}`) : of(null),
      totalOrganizations: this.canViewOrganizations ? this.fetchTotal(`/api/v1/organizations${orgOnlyQuery}`) : of(null),
      totalLicenses: this.canViewLicenses ? this.fetchTotal(`/api/v1/licenses${orgOnlyQuery}`) : of(null),
      totalSalesInvoices: this.canViewSalesInvoices ? this.fetchTotal(`/api/v1/sales-invoices?limit=1${orgParam}`) : of(null),
      pendingOrders: this.canViewOrders ? this.fetchTotal(`/api/v1/orders?limit=1&status=pending${orgParam}`) : of(0),
      confirmedOrders: this.canViewOrders ? this.fetchTotal(`/api/v1/orders?limit=1&status=confirmed${orgParam}`) : of(0),
      processingOrders: this.canViewOrders ? this.fetchTotal(`/api/v1/orders?limit=1&status=processing${orgParam}`) : of(0),
      completedOrders: this.canViewOrders ? this.fetchTotal(`/api/v1/orders?limit=1&status=completed${orgParam}`) : of(0),
      cancelledOrders: this.canViewOrders ? this.fetchTotal(`/api/v1/orders?limit=1&status=cancelled${orgParam}`) : of(0),
    }).subscribe({
      next: (result) => {
        this.loading = false;
        this.health = result.health;
        this.metrics = {
          totalItems: result.totalItems,
          totalCustomers: result.totalCustomers,
          totalOrders: result.totalOrders,
          totalUsers: result.totalUsers,
          totalOrganizations: result.totalOrganizations,
          totalLicenses: result.totalLicenses,
          totalSalesInvoices: result.totalSalesInvoices,
        };
        this.orderStatusCounts = this.canViewOrders
          ? [
              { label: 'Pending', value: result.pendingOrders, className: 'bg-warning' },
              { label: 'Confirmed', value: result.confirmedOrders, className: 'bg-primary' },
              { label: 'Processing', value: result.processingOrders, className: 'bg-info' },
              { label: 'Completed', value: result.completedOrders, className: 'bg-success' },
              { label: 'Cancelled', value: result.cancelledOrders, className: 'bg-danger' },
            ]
          : [];
        this.orderStatusMax = Math.max(1, ...this.orderStatusCounts.map((row) => row.value));
        if (this.canViewReports && this.canViewFinancialCharts) {
          this.loadChart();
        }
      },
      error: () => {
        this.loading = false;
        this.error = 'Unable to load dashboard metrics.';
      },
    });
  }

  setChartView(view: 'monthly' | 'quarterly'): void {
    if (this.chartView === view) {
      return;
    }
    this.chartView = view;
    this.loadChart();
  }

  onYearChange(value: string): void {
    const parsed = Number(value);
    this.selectedYear = Number.isInteger(parsed) ? parsed : new Date().getFullYear();
    this.loadChart();
  }

  maxOrderStatusCount(): number {
    return this.orderStatusMax;
  }

  orderStatusWidth(value: number): number {
    return Math.round((value / this.orderStatusMax) * 100);
  }

  trackByOrderStatus(_index: number, row: { label: string }): string {
    return row.label;
  }

  private loadChart(): void {
    if (this.chartView === 'monthly') {
      this.loadMonthlyChart();
    } else {
      this.loadQuarterlyChart();
    }
  }

  private loadMonthlyChart(): void {
    this.chartLoading = true;
    this.chartError = '';

    const params = new URLSearchParams({ year: String(this.selectedYear) });
    if (this.orgParamValue) {
      params.set('organizationId', this.orgParamValue);
    }

    this.api.get<MonthlySummaryResponse>(`/api/v1/dashboard/monthly-summary?${params.toString()}`).pipe(
      map((response) => response.data),
      catchError(() => of(null))
    ).subscribe({
      next: (data) => {
        this.chartLoading = false;
        if (!data) {
          this.chartError = 'Unable to load monthly sales and expense data.';
          return;
        }
        this.yearlySalesTotal = data.totalSales;
        this.yearlyExpenseTotal = data.totalExpenses;
        this.renderChart(
          data.months.map((m) => m.monthName),
          data.months.map((m) => m.sales),
          data.months.map((m) => m.expenses)
        );
      },
      error: () => {
        this.chartLoading = false;
        this.chartError = 'Unable to load monthly sales and expense data.';
      },
    });
  }

  private loadQuarterlyChart(): void {
    this.chartLoading = true;
    this.chartError = '';

    const salesParams = new URLSearchParams({
      issueDateFrom: `${this.selectedYear}-01-01`,
      issueDateTo: `${this.selectedYear}-12-31`,
      limit: '10000',
      page: '1',
    });
    const expenseParams = new URLSearchParams({
      expenseDateFrom: `${this.selectedYear}-01-01`,
      expenseDateTo: `${this.selectedYear}-12-31`,
      limit: '10000',
      page: '1',
    });

    if (this.orgParamValue) {
      salesParams.set('organizationId', this.orgParamValue);
      expenseParams.set('organizationId', this.orgParamValue);
    }

    forkJoin({
      sales: this.api.list<SalesInvoiceDashboardRow>(`/api/v1/sales-invoices?${salesParams.toString()}`).pipe(
        map((response) => response.data || []),
        catchError(() => of([]))
      ),
      expenses: this.api.list<ExpenseDashboardRow>(`/api/v1/expenses?${expenseParams.toString()}`).pipe(
        map((response) => response.data || []),
        catchError(() => of([]))
      ),
    }).subscribe({
      next: ({ sales, expenses }) => {
        this.chartLoading = false;
        const quarterTotals = {
          sales: [0, 0, 0, 0],
          expenses: [0, 0, 0, 0],
        };

        for (const row of sales) {
          const quarter = this.quarterFromDate(row.issueDate);
          if (!quarter) continue;
          quarterTotals.sales[quarter - 1] += Number(row.totalAmount || 0);
        }
        for (const row of expenses) {
          const quarter = this.quarterFromDate(row.expenseDate);
          if (!quarter) continue;
          quarterTotals.expenses[quarter - 1] += Number(row.totalAmount || 0);
        }

        this.yearlySalesTotal = quarterTotals.sales.reduce((sum, v) => sum + v, 0);
        this.yearlyExpenseTotal = quarterTotals.expenses.reduce((sum, v) => sum + v, 0);
        this.renderChart(['Q1', 'Q2', 'Q3', 'Q4'], quarterTotals.sales, quarterTotals.expenses);
      },
      error: () => {
        this.chartLoading = false;
        this.chartError = 'Unable to load quarterly sales and expense reports.';
      },
    });
  }

  private quarterFromDate(value: unknown): number | null {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const month = Number(raw.split('-')[1]);
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;
    return Math.floor((month - 1) / 3) + 1;
  }

  private destroyChart(): void {
    if (this.salesExpenseChart) {
      this.salesExpenseChart.destroy();
      this.salesExpenseChart = null;
    }
  }

  private renderChart(labels: string[], sales: number[], expenses: number[]): void {
    const canvas = this.salesExpenseChartRef?.nativeElement;
    if (!canvas) return;

    this.destroyChart();

    this.salesExpenseChart = new Chart<'bar', number[], string>(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Sales',
            data: sales,
            backgroundColor: '#198754cc',
            borderColor: '#198754',
            borderWidth: 1,
            borderRadius: 6,
          },
          {
            label: 'Expenses',
            data: expenses,
            backgroundColor: '#dc3545cc',
            borderColor: '#dc3545',
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: (ctx: TooltipItem<'bar'>) => {
                const value = Number(ctx.raw || 0);
                return `${ctx.dataset.label}: ${this.toCurrency(value, this.orgCurrency)}`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (tickValue: string | number) =>
                this.toCurrency(Number(tickValue || 0), this.orgCurrency, 0, 0),
            },
          },
        },
      },
    });
  }

  toCurrency(
    value: number | string | null | undefined,
    currency = 'USD',
    minimumFractionDigits = 2,
    maximumFractionDigits = 2
  ): string {
    const numeric = Number(value || 0);
    const safeCurrency = this.normalizeCurrencyCode(currency);
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: safeCurrency,
        minimumFractionDigits,
        maximumFractionDigits,
      }).format(Number.isFinite(numeric) ? numeric : 0);
    } catch (_err) {
      return `${safeCurrency} ${(Number.isFinite(numeric) ? numeric : 0).toFixed(2)}`;
    }
  }

  private normalizeCurrencyCode(currency: unknown): string {
    const raw = String(currency || '').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(raw) ? raw : 'USD';
  }

  private fetchTotal(endpoint: string) {
    return this.api.list<unknown>(endpoint).pipe(
      map((response: ApiResponse<unknown[]>) => Number(response.meta?.total || 0) || 0),
      catchError(() => of(0))
    );
  }
}
