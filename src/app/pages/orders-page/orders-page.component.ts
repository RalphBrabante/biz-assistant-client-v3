import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ApiResponse } from '../../core/types';
import { loadTablePreferences, saveTablePreferences, toPositiveInt, toTableViewMode, TableViewMode } from '../../core/table-preferences';
import { TooltipDirective } from '../../shared/tooltip.directive';

@Component({
  selector: 'app-orders-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TooltipDirective],
  templateUrl: './orders-page.component.html',
})
export class OrdersPageComponent {
  private readonly api = inject(ApiService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);

  rows: Record<string, unknown>[] = [];
  loading = false;
  deletingId = '';
  error = '';
  searchQuery = '';
  statusFilter = '';
  paymentFilter = '';
  page = 1;
  pageSize = 20;
  readonly pageSizeOptions = [10, 20, 50, 100];
  total = 0;
  totalPages = 1;
  viewMode: TableViewMode = 'table';
  private readonly tablePrefsKey = 'orders-page';
  private readonly currencyFormatterCache = new Map<string, Intl.NumberFormat>();

  get isSuperuser(): boolean {
    return this.organizationContext.isSuperuser();
  }

  ngOnInit(): void {
    this.restoreTablePreferences();
    this.load();
  }

  load(): void {
    this.loading = true;
    const params = new URLSearchParams({
      page: String(this.page),
      limit: String(this.pageSize),
    });
    const q = this.searchQuery.trim();
    if (q) {
      params.set('q', q);
    }
    if (this.statusFilter) {
      params.set('status', this.statusFilter);
    }
    if (this.paymentFilter) {
      params.set('paymentStatus', this.paymentFilter);
    }

    this.api.list<Record<string, unknown>>(`/api/v1/orders?${params.toString()}`).subscribe({
      next: (response: ApiResponse<Record<string, unknown>[]>) => {
        this.loading = false;
        this.rows = response.data || [];
        const meta = response.meta || {};
        this.total = Number(meta.total || 0);
        this.totalPages = Math.max(1, Number(meta.totalPages || 1));
        this.page = Math.max(1, Number(meta.page || this.page));
        this.persistTablePreferences();
        if (this.page > this.totalPages) {
          this.page = this.totalPages;
          this.load();
        }
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Unable to load orders.';
      },
    });
  }

  async remove(id: unknown): Promise<void> {
    const orderId = String(id || '');
    if (!orderId) {
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Order',
      message: 'Delete this order? This action cannot be undone.',
      confirmText: 'Delete Order',
      confirmButtonClass: 'btn-danger',
      iconClass: 'bi-receipt-cutoff',
    });
    if (!confirmed) {
      return;
    }

    this.deletingId = orderId;
    this.api.remove('/api/v1/orders', orderId).subscribe({
      next: () => {
        this.deletingId = '';
        this.load();
      },
      error: (err) => {
        this.deletingId = '';
        this.error = err?.error?.message || 'Unable to delete order.';
      },
    });
  }

  orderedCount(row: Record<string, unknown>): number {
    const snapshots = row['orderedItemSnapshots'];
    if (Array.isArray(snapshots)) {
      return snapshots.length;
    }
    return 0;
  }

  orderStatusBadgeClass(status: unknown): string {
    switch (String(status || '').toLowerCase()) {
      case 'completed':
      case 'fulfilled':
        return 'text-bg-success';
      case 'confirmed':
      case 'processing':
        return 'text-bg-primary';
      case 'pending':
      case 'draft':
        return 'text-bg-warning';
      case 'cancelled':
      case 'refunded':
        return 'text-bg-danger';
      default:
        return 'text-bg-secondary';
    }
  }

  orderPaymentBadgeClass(status: unknown): string {
    switch (String(status || '').toLowerCase()) {
      case 'paid':
        return 'text-bg-success';
      case 'partially_paid':
      case 'partial':
        return 'text-bg-info';
      case 'refunded':
        return 'text-bg-warning';
      case 'failed':
        return 'text-bg-danger';
      case 'unpaid':
      default:
        return 'text-bg-secondary';
    }
  }

  organizationLabel(row: Record<string, unknown>): string {
    const org = row['organization'] as { name?: string; legalName?: string } | undefined;
    return org?.name || org?.legalName || String(row['organizationId'] || '-') || '-';
  }

  formatMoney(value: unknown, row?: Record<string, unknown>): string {
    const amount = Number(value ?? 0);
    const code = String(row?.['currency'] || 'USD').toUpperCase();
    const normalizedAmount = Number.isFinite(amount) ? amount : 0;
    const formatter = this.currencyFormatterCache.get(code);
    if (formatter) {
      return formatter.format(normalizedAmount);
    }

    try {
      const created = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      this.currencyFormatterCache.set(code, created);
      return created.format(normalizedAmount);
    } catch (_err) {
      return `${code} ${normalizedAmount.toFixed(2)}`;
    }
  }

  trackById(_index: number, row: Record<string, unknown>): string {
    return String(row['id'] || _index);
  }

  onSearchChange(value: string): void {
    this.searchQuery = value;
    this.page = 1;
    this.load();
  }

  applyFilters(): void {
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  onPageSizeChange(value: string): void {
    const parsed = Number(value);
    this.pageSize = Number.isFinite(parsed) ? parsed : 20;
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  setViewMode(mode: TableViewMode): void {
    this.viewMode = mode;
    this.persistTablePreferences();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.page || this.loading) {
      return;
    }
    this.page = page;
    this.persistTablePreferences();
    this.load();
  }

  private restoreTablePreferences(): void {
    const prefs = loadTablePreferences(this.tablePrefsKey);
    this.page = toPositiveInt(prefs['page'], this.page);
    this.pageSize = toPositiveInt(prefs['pageSize'], this.pageSize);
    this.viewMode = toTableViewMode(prefs['viewMode'], this.viewMode);
  }

  private persistTablePreferences(): void {
    saveTablePreferences(this.tablePrefsKey, {
      page: this.page,
      pageSize: this.pageSize,
      viewMode: this.viewMode,
    });
  }
}
