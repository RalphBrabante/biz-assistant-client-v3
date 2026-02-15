import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ApiResponse } from '../core/types';

interface SalesInvoiceRow {
  id: string;
  organizationId: string;
  orderId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  status?: string;
  paymentStatus?: string;
  currency?: string;
  subtotalAmount?: number;
  taxAmount?: number;
  discountAmount?: number;
  totalAmount?: number;
  paidAt?: string;
  notes?: string;
  order?: {
    id: string;
    orderNumber?: string;
    shippingAmount?: number;
    customer?: {
      id: string;
      name?: string;
      taxId?: string;
    };
    orderedItemSnapshots?: SnapshotRow[];
  };
}

interface SnapshotRow {
  id: string;
  name?: string;
  sku?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  lineSubtotal?: number;
  lineDiscount?: number;
  lineTax?: number;
  lineTotal?: number;
}

@Component({
  selector: 'app-sales-invoice-detail-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './sales-invoice-detail-page.component.html',
})
export class SalesInvoiceDetailPageComponent {
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly invoice = signal<SalesInvoiceRow | null>(null);

  invoiceId = '';
  status = 'draft';

  readonly statusOptions = [
    'draft',
    'issued',
    'sent',
    'partially_paid',
    'overdue',
    'paid',
    'cancelled',
  ];

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.invoiceId = String(this.route.snapshot.paramMap.get('id') || '');
    if (!this.invoiceId) {
      this.error.set('Sales invoice ID is missing.');
      return;
    }
    this.loadInvoice();
  }

  get isPaid(): boolean {
    return String(this.invoice()?.status || '').toLowerCase() === 'paid';
  }

  get printableStatus(): string {
    const current = String(this.invoice()?.status || '').toLowerCase();
    return current === 'void' ? 'cancelled' : current || '-';
  }

  get orderedItems(): SnapshotRow[] {
    return this.invoice()?.order?.orderedItemSnapshots || [];
  }

  get orderShippingAmount(): number {
    return Number(this.invoice()?.order?.shippingAmount || 0);
  }

  get itemsSubtotal(): number {
    const value = this.orderedItems.reduce((acc, row) => acc + Number(row.lineSubtotal || 0), 0);
    return Number(value.toFixed(2));
  }

  get itemsDiscount(): number {
    const value = this.orderedItems.reduce((acc, row) => acc + Number(row.lineDiscount || 0), 0);
    return Number(value.toFixed(2));
  }

  get itemsTax(): number {
    const value = this.orderedItems.reduce((acc, row) => acc + Number(row.lineTax || 0), 0);
    return Number(value.toFixed(2));
  }

  get itemsTotal(): number {
    const value = this.orderedItems.reduce((acc, row) => acc + Number(row.lineTotal || 0), 0) + this.orderShippingAmount;
    return Number(value.toFixed(2));
  }

  saveStatus(): void {
    if (this.submitting() || !this.invoiceId || this.isPaid) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    this.api
      .update<SalesInvoiceRow>('/api/v1/sales-invoices', this.invoiceId, { status: this.status })
      .subscribe({
        next: (response: ApiResponse<SalesInvoiceRow>) => {
          this.submitting.set(false);
          this.message.set(response.message || 'Sales invoice status updated successfully.');
          this.loadInvoice();
        },
        error: (err) => {
          this.submitting.set(false);
          this.error.set(err?.error?.message || 'Unable to update sales invoice status.');
        },
      });
  }

  markCancelled(): void {
    if (this.submitting() || this.isPaid) {
      return;
    }
    this.status = 'cancelled';
    this.saveStatus();
  }

  printInvoice(): void {
    window.print();
  }

  private loadInvoice(): void {
    this.loading.set(true);
    this.error.set('');

    this.api.get<SalesInvoiceRow>(`/api/v1/sales-invoices/${this.invoiceId}`).subscribe({
      next: (response: ApiResponse<SalesInvoiceRow>) => {
        this.loading.set(false);
        const row = response.data || null;
        this.invoice.set(row);
        this.status = this.normalizeStatusForUi(row?.status);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Unable to load sales invoice.');
      },
    });
  }

  private normalizeStatusForUi(status: unknown): string {
    const normalized = String(status || '').toLowerCase();
    return normalized === 'void' ? 'cancelled' : normalized || 'draft';
  }
}
