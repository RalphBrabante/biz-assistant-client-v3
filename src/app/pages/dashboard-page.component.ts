import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ApiResponse } from '../core/types';
import { catchError, forkJoin, map, of } from 'rxjs';

interface DashboardMetrics {
  totalItems: number | null;
  totalCustomers: number | null;
  totalOrders: number | null;
  totalUsers: number | null;
  totalOrganizations: number | null;
  totalLicenses: number | null;
  totalSalesInvoices: number | null;
}

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard-page.component.html',
})
export class DashboardPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  loading = false;
  error = '';
  health: Record<string, unknown> | null = null;
  metrics: DashboardMetrics | null = null;
  orderStatusCounts: Array<{ label: string; value: number; className: string }> = [];

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
}
