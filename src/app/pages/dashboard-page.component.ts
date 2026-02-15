import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  OnDestroy,
  ViewChild,
  ElementRef,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { OrganizationContextService } from '../core/organization-context.service';
import { ApiResponse } from '../core/types';
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

interface QuarterlySalesReportRow {
  quarter: number;
  organizationId: string;
  totalAmount: number;
  currency: string;
}

interface QuarterlyExpenseReportRow {
  quarter: number;
  organizationId: string;
  totalAmount: number;
  currency: string;
}

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard-page.component.html',
})
export class DashboardPageComponent implements AfterViewInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly organizationContext = inject(OrganizationContextService);

  @ViewChild('yearlyReportChart') yearlyReportChartRef?: ElementRef<HTMLCanvasElement>;
  private yearlyChart: Chart<'bar', number[], string> | null = null;

  loading = false;
  error = '';
  health: Record<string, unknown> | null = null;
  metrics: DashboardMetrics | null = null;
  orderStatusCounts: Array<{ label: string; value: number; className: string }> = [];
  selectedYear = new Date().getFullYear();
  chartLoading = false;
  chartError = '';
  yearlySalesTotal = 0;
  yearlyExpenseTotal = 0;
  yearlyCurrency = 'USD';

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

  get availableYears(): number[] {
    const current = new Date().getFullYear();
    return Array.from({ length: 8 }, (_v, index) => current - index);
  }

  get isSuperuser(): boolean {
    const roleCodes = (this.auth.currentUser()?.roleCodes || []).map((code) =>
      String(code || '').toLowerCase()
    );
    return roleCodes.includes('superuser');
  }

  get currentOrganizationCurrency(): string {
    return String(this.auth.currentUser()?.currency || 'USD').toUpperCase();
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

  ngAfterViewInit(): void {
    if (this.canViewReports) {
      this.loadYearlyReportsChart();
    }
  }

  ngOnDestroy(): void {
    if (this.yearlyChart) {
      this.yearlyChart.destroy();
      this.yearlyChart = null;
    }
  }

  ngOnInit(): void {
    this.refresh();
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
        if (this.canViewReports) {
          this.loadYearlyReportsChart();
        }
      },
      error: () => {
        this.loading = false;
        this.error = 'Unable to load dashboard metrics.';
      },
    });
  }

  maxOrderStatusCount(): number {
    return Math.max(1, ...this.orderStatusCounts.map((row) => row.value));
  }

  orderStatusWidth(value: number): number {
    return Math.round((value / this.maxOrderStatusCount()) * 100);
  }

  private fetchTotal(endpoint: string) {
    return this.api.list<unknown>(endpoint).pipe(
      map((response: ApiResponse<unknown[]>) => Number(response.meta?.total || 0) || 0),
      catchError(() => of(0))
    );
  }

  onYearChange(value: string): void {
    const parsed = Number(value);
    this.selectedYear = Number.isInteger(parsed) ? parsed : new Date().getFullYear();
    this.loadYearlyReportsChart();
  }

  private loadYearlyReportsChart(): void {
    this.chartLoading = true;
    this.chartError = '';

    const salesParams = new URLSearchParams({
      year: String(this.selectedYear),
      limit: '100',
      page: '1',
    });
    const expenseParams = new URLSearchParams({
      year: String(this.selectedYear),
      limit: '100',
      page: '1',
    });

    if (this.orgParamValue) {
      salesParams.set('organizationId', this.orgParamValue);
      expenseParams.set('organizationId', this.orgParamValue);
    }

    forkJoin({
      sales: this.api.list<QuarterlySalesReportRow>(`/api/v1/reports/quarterly-sales?${salesParams.toString()}`).pipe(
        map((response) => response.data || []),
        catchError(() => of([]))
      ),
      expenses: this.api.list<QuarterlyExpenseReportRow>(`/api/v1/reports/quarterly-expenses?${expenseParams.toString()}`).pipe(
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
          const qIndex = Math.max(1, Math.min(4, Number(row.quarter || 0))) - 1;
          quarterTotals.sales[qIndex] = Number(row.totalAmount || 0);
        }

        for (const row of expenses) {
          const qIndex = Math.max(1, Math.min(4, Number(row.quarter || 0))) - 1;
          quarterTotals.expenses[qIndex] = Number(row.totalAmount || 0);
        }

        this.yearlySalesTotal = quarterTotals.sales.reduce((sum, value) => sum + value, 0);
        this.yearlyExpenseTotal = quarterTotals.expenses.reduce((sum, value) => sum + value, 0);
        this.yearlyCurrency =
          String(sales[0]?.currency || expenses[0]?.currency || this.currentOrganizationCurrency).toUpperCase();

        this.renderYearlyChart(quarterTotals.sales, quarterTotals.expenses);
      },
      error: () => {
        this.chartLoading = false;
        this.chartError = 'Unable to load yearly sales and expense reports.';
      },
    });
  }

  private renderYearlyChart(sales: number[], expenses: number[]): void {
    const canvas = this.yearlyReportChartRef?.nativeElement;
    if (!canvas) {
      return;
    }

    if (this.yearlyChart) {
      this.yearlyChart.destroy();
      this.yearlyChart = null;
    }

    this.yearlyChart = new Chart<'bar', number[], string>(canvas, {
      type: 'bar',
      data: {
        labels: ['Q1', 'Q2', 'Q3', 'Q4'],
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
          legend: {
            position: 'top',
          },
          tooltip: {
            callbacks: {
              label: (ctx: TooltipItem<'bar'>) => {
                const value = Number(ctx.raw || 0);
                const formatted = new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: this.yearlyCurrency,
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }).format(value);
                return `${ctx.dataset.label}: ${formatted}`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (tickValue: string | number) => {
                const value = Number(tickValue || 0);
                return new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: this.yearlyCurrency,
                  maximumFractionDigits: 0,
                }).format(value);
              },
            },
          },
        },
      },
    });
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
}
