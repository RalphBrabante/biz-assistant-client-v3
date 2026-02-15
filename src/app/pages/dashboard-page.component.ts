import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ApiResponse } from '../core/types';
import { catchError, forkJoin, map, of } from 'rxjs';

interface DashboardMetrics {
  totalItems: number;
  totalCustomers: number;
  totalOrders: number;
  totalUsers: number;
  totalOrganizations: number;
  totalLicenses: number;
  totalSalesInvoices: number;
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

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.error = '';
    const organizationId = this.auth.currentUser()?.organizationId || '';
    const orgParam = organizationId ? `&organizationId=${encodeURIComponent(organizationId)}` : '';

    forkJoin({
      health: this.api.get<Record<string, unknown>>('/api/v1/health').pipe(
        map((response) => response.data || null),
        catchError(() => of(null))
      ),
      totalItems: this.fetchTotal(`/api/v1/items?limit=1${orgParam}`),
      totalCustomers: this.fetchTotal(`/api/v1/customers?limit=1${orgParam}`),
      totalOrders: this.fetchTotal(`/api/v1/orders?limit=1${orgParam}`),
      totalUsers: this.fetchTotal(`/api/v1/users?limit=1${orgParam}`),
      totalOrganizations: this.fetchTotal('/api/v1/organizations?limit=1'),
      totalLicenses: this.fetchTotal('/api/v1/licenses?limit=1'),
      totalSalesInvoices: this.fetchTotal(`/api/v1/sales-invoices?limit=1${orgParam}`),
      pendingOrders: this.fetchTotal(`/api/v1/orders?limit=1&status=pending${orgParam}`),
      confirmedOrders: this.fetchTotal(`/api/v1/orders?limit=1&status=confirmed${orgParam}`),
      processingOrders: this.fetchTotal(`/api/v1/orders?limit=1&status=processing${orgParam}`),
      completedOrders: this.fetchTotal(`/api/v1/orders?limit=1&status=completed${orgParam}`),
      cancelledOrders: this.fetchTotal(`/api/v1/orders?limit=1&status=cancelled${orgParam}`),
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
        this.orderStatusCounts = [
          { label: 'Pending', value: result.pendingOrders, className: 'bg-warning' },
          { label: 'Confirmed', value: result.confirmedOrders, className: 'bg-primary' },
          { label: 'Processing', value: result.processingOrders, className: 'bg-info' },
          { label: 'Completed', value: result.completedOrders, className: 'bg-success' },
          { label: 'Cancelled', value: result.cancelledOrders, className: 'bg-danger' },
        ];
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
      map((response: ApiResponse<unknown[]>) => Number(response.meta?.total || 0)),
      catchError(() => of(0))
    );
  }
}
