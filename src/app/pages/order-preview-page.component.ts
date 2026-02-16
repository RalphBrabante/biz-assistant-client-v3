import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ConfirmDialogService } from '../core/confirm-dialog.service';
import { ApiResponse } from '../core/types';

interface ItemRow {
  id: string;
  organizationId: string;
  type?: string;
  name: string;
  sku?: string;
  category?: string;
  price?: number;
  discountedPrice?: number;
  taxRate?: number;
  stock?: number;
  currency?: string;
  isActive?: boolean;
}

interface CustomerRow {
  id: string;
  organizationId: string;
  name: string;
  taxId: string;
  isActive?: boolean;
}

interface OrderSnapshotRow {
  id: string;
  itemId?: string;
  sku?: string;
  name?: string;
  quantity?: number;
  unit?: string;
  currency?: string;
  unitPrice?: number;
  discountedUnitPrice?: number;
  taxRate?: number;
  lineSubtotal?: number;
  lineDiscount?: number;
  lineTax?: number;
  lineTotal?: number;
}

interface OrderRow {
  id: string;
  organizationId: string;
  orderNumber: string;
  createdAt?: string;
  customerId?: string;
  customer?: {
    id: string;
    name?: string;
    taxId?: string;
  };
  status?: string;
  paymentStatus?: string;
  fulfillmentStatus?: string;
  shippingAmount?: number;
  notes?: string;
  orderedItemSnapshots?: OrderSnapshotRow[];
}

interface CartItem {
  item: ItemRow;
  quantity: number;
}

@Component({
  selector: 'app-order-preview-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './order-preview-page.component.html',
})
export class OrderPreviewPageComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmDialog = inject(ConfirmDialogService);

  orderId = '';
  order: OrderRow | null = null;
  loading = false;
  saving = false;
  error = '';
  message = '';

  status = 'pending';
  paymentStatus = 'unpaid';
  fulfillmentStatus = 'unfulfilled';
  shippingAmount = 0;
  notes = '';

  customerSearchQuery = '';
  customerResults: CustomerRow[] = [];
  selectedCustomerId = '';
  searchingCustomers = false;

  itemSearchQuery = '';
  catalogItems: ItemRow[] = [];
  catalogLoading = false;
  cart: CartItem[] = [];
  showCompleteModal = false;
  completionSalesInvoiceId = '';
  completionSalesInvoiceIssueDate = '';
  completionModalError = '';

  ngOnInit(): void {
    this.orderId = String(this.route.snapshot.paramMap.get('id') || '');
    if (!this.orderId) {
      this.error = 'Order ID is missing.';
      return;
    }
    this.loadOrder();
  }

  get isCompleted(): boolean {
    return String(this.order?.status || '').toLowerCase() === 'completed';
  }

  get isLocked(): boolean {
    return this.isCompleted || String(this.status || '').toLowerCase() === 'completed';
  }

  get organizationId(): string {
    return this.order?.organizationId || '';
  }

  loadOrder(): void {
    this.loading = true;
    this.error = '';
    this.message = '';

    this.api.get<OrderRow>(`/api/v1/orders/${this.orderId}`).subscribe({
      next: (response: ApiResponse<OrderRow>) => {
        this.loading = false;
        const order = response.data || null;
        this.order = order;
        if (!order) {
          this.error = 'Order not found.';
          return;
        }

        this.status = String(order.status || 'pending');
        this.paymentStatus = String(order.paymentStatus || 'unpaid');
        this.fulfillmentStatus = String(order.fulfillmentStatus || 'unfulfilled');
        this.shippingAmount = Number(order.shippingAmount || 0);
        this.notes = String(order.notes || '');
        this.selectedCustomerId = String(order.customerId || order.customer?.id || '');
        this.customerResults = order.customer ? [{ id: order.customer.id, organizationId: order.organizationId, name: order.customer.name || '', taxId: order.customer.taxId || '' }] : [];

        this.loadItemsForOrganization();
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Unable to load order.';
      },
    });
  }

  loadItemsForOrganization(): void {
    if (!this.organizationId) return;

    this.catalogLoading = true;
    this.api.list<ItemRow>(`/api/v1/items?organizationId=${encodeURIComponent(this.organizationId)}&isActive=true&limit=300`).subscribe({
      next: (response: ApiResponse<ItemRow[]>) => {
        this.catalogLoading = false;
        this.catalogItems = response.data || [];
        this.initializeCartFromOrder();
      },
      error: (err) => {
        this.catalogLoading = false;
        this.error = err?.error?.message || 'Unable to load items catalog.';
      },
    });
  }

  initializeCartFromOrder(): void {
    const snapshots = this.order?.orderedItemSnapshots || [];
    const byId = new Map(this.catalogItems.map((item) => [item.id, item]));
    this.cart = snapshots
      .map((row) => {
        const itemId = String(row.itemId || '');
        if (!itemId) return null;
        const item = byId.get(itemId);
        if (!item) return null;
        return {
          item,
          quantity: Math.max(1, Number(row.quantity || 1)),
        } as CartItem;
      })
      .filter((row): row is CartItem => Boolean(row));
  }

  searchItems(): void {
    if (this.isLocked) return;
    if (!this.organizationId) {
      this.error = 'Order organization is missing.';
      return;
    }

    this.catalogLoading = true;
    this.error = '';
    const q = encodeURIComponent(this.itemSearchQuery.trim());
    this.api
      .list<ItemRow>(`/api/v1/items?organizationId=${encodeURIComponent(this.organizationId)}&q=${q}&isActive=true&limit=100`)
      .subscribe({
        next: (response: ApiResponse<ItemRow[]>) => {
          this.catalogLoading = false;
          this.catalogItems = response.data || [];
        },
        error: (err) => {
          this.catalogLoading = false;
          this.error = err?.error?.message || 'Unable to search items.';
        },
      });
  }

  searchCustomers(): void {
    if (this.isLocked) return;
    if (!this.organizationId) {
      this.error = 'Order organization is missing.';
      return;
    }

    this.searchingCustomers = true;
    this.error = '';

    const q = encodeURIComponent(this.customerSearchQuery.trim());
    const endpoint = `/api/v1/customers?organizationId=${encodeURIComponent(this.organizationId)}&q=${q}&isActive=true&limit=30`;

    this.api.list<CustomerRow>(endpoint).subscribe({
      next: (response: ApiResponse<CustomerRow[]>) => {
        this.searchingCustomers = false;
        this.customerResults = (response.data || []).filter((row) => row.isActive !== false);
      },
      error: (err) => {
        this.searchingCustomers = false;
        this.error = err?.error?.message || 'Unable to search customers.';
      },
    });
  }

  addToCart(item: ItemRow): void {
    if (this.isLocked) return;
    const existing = this.cart.find((entry) => entry.item.id === item.id);
    if (existing) {
      this.increase(item.id);
      return;
    }
    if (item.type === 'product' && this.maxStock(item) <= 0) {
      this.message = `Cannot add ${item.name}. No available stock.`;
      return;
    }
    this.cart.push({ item, quantity: 1 });
  }

  increase(itemId: string): void {
    if (this.isLocked) return;
    const entry = this.cart.find((row) => row.item.id === itemId);
    if (!entry) return;
    if (entry.item.type === 'product' && entry.quantity >= this.maxStock(entry.item)) {
      this.message = `Cannot add more of ${entry.item.name}. Reached available stock (${this.maxStock(entry.item)}).`;
      return;
    }
    entry.quantity += 1;
  }

  decrease(itemId: string): void {
    if (this.isLocked) return;
    const entry = this.cart.find((row) => row.item.id === itemId);
    if (!entry) return;
    entry.quantity -= 1;
    if (entry.quantity <= 0) {
      this.removeFromCart(itemId);
    }
  }

  async removeFromCart(itemId: string): Promise<void> {
    if (this.isLocked) return;
    const confirmed = await this.confirmDialog.confirm({
      title: 'Remove Item',
      message: 'Remove this item from the order cart?',
      confirmText: 'Remove',
      confirmButtonClass: 'btn-danger',
      iconClass: 'bi-cart-x',
    });
    if (!confirmed) {
      return;
    }
    this.cart = this.cart.filter((row) => row.item.id !== itemId);
  }

  maxStock(item: ItemRow): number {
    return Math.max(0, Number(item.stock ?? 0));
  }

  itemUnitPrice(item: ItemRow): number {
    const discounted = Number(item.discountedPrice ?? NaN);
    if (Number.isFinite(discounted) && discounted >= 0) {
      return discounted;
    }
    return Number(item.price ?? 0);
  }

  get subtotalAmount(): number {
    const subtotal = this.cart.reduce((acc, row) => acc + this.itemUnitPrice(row.item) * row.quantity, 0);
    return Number(subtotal.toFixed(2));
  }

  get taxAmount(): number {
    const tax = this.cart.reduce((acc, row) => {
      const base = this.itemUnitPrice(row.item) * row.quantity;
      const rate = Number(row.item.taxRate ?? 0) / 100;
      return acc + base * rate;
    }, 0);
    return Number(tax.toFixed(2));
  }

  get discountAmount(): number {
    const discount = this.cart.reduce((acc, row) => {
      const full = Number(row.item.price ?? 0) * row.quantity;
      const effective = this.itemUnitPrice(row.item) * row.quantity;
      return acc + Math.max(0, full - effective);
    }, 0);
    return Number(discount.toFixed(2));
  }

  get totalAmount(): number {
    return Number((this.subtotalAmount + this.taxAmount + Number(this.shippingAmount || 0)).toFixed(2));
  }

  get selectedCustomer(): CustomerRow | undefined {
    return this.customerResults.find((row) => row.id === this.selectedCustomerId);
  }

  get deliveryLines(): OrderSnapshotRow[] {
    return this.order?.orderedItemSnapshots || [];
  }

  get deliverySubtotal(): number {
    const value = this.deliveryLines.reduce((acc, row) => acc + Number(row.lineSubtotal || 0), 0);
    return Number(value.toFixed(2));
  }

  get deliveryTax(): number {
    const value = this.deliveryLines.reduce((acc, row) => acc + Number(row.lineTax || 0), 0);
    return Number(value.toFixed(2));
  }

  get deliveryDiscount(): number {
    const value = this.deliveryLines.reduce((acc, row) => acc + Number(row.lineDiscount || 0), 0);
    return Number(value.toFixed(2));
  }

  get deliveryTotal(): number {
    const value = this.deliveryLines.reduce((acc, row) => acc + Number(row.lineTotal || 0), 0) + Number(this.shippingAmount || 0);
    return Number(value.toFixed(2));
  }

  saveOrder(): void {
    if (this.isCompleted) {
      this.error = 'Completed orders are locked and can no longer be edited.';
      return;
    }
    if (!this.orderId) return;
    if (!this.selectedCustomerId) {
      this.error = 'Please select a customer.';
      return;
    }
    if (this.cart.length === 0) {
      this.error = 'Order must have at least one item.';
      return;
    }

    this.error = '';
    this.message = '';

    const payload: Record<string, unknown> = {
      customerId: this.selectedCustomerId,
      status: this.status,
      paymentStatus: this.paymentStatus,
      fulfillmentStatus: this.fulfillmentStatus,
      shippingAmount: Number(this.shippingAmount || 0),
      subtotalAmount: this.subtotalAmount,
      taxAmount: this.taxAmount,
      discountAmount: this.discountAmount,
      totalAmount: this.totalAmount,
      notes: this.notes.trim() || undefined,
    };

    // If transitioning to completed, do not reprocess/replace order items.
    if (String(this.status).toLowerCase() !== 'completed') {
      payload['orderedItems'] = this.cart.map((row) => ({
        itemId: row.item.id,
        quantity: row.quantity,
      }));
    }

    if (!this.isCompleted && String(this.status).toLowerCase() === 'completed') {
      this.completionSalesInvoiceId = '';
      this.completionSalesInvoiceIssueDate = this.todayIsoDate();
      this.completionModalError = '';
      this.showCompleteModal = true;
      return;
    }

    this.submitOrderUpdate(payload);
  }

  closeCompleteModal(): void {
    if (this.saving) return;
    this.showCompleteModal = false;
    this.completionModalError = '';
  }

  confirmCompletion(): void {
    const salesInvoiceId = this.completionSalesInvoiceId.trim();
    if (!salesInvoiceId) {
      this.completionModalError = 'Sales Invoice ID is required to complete this order.';
      return;
    }
    this.completionModalError = '';

    const payload: Record<string, unknown> = {
      customerId: this.selectedCustomerId,
      status: this.status,
      paymentStatus: this.paymentStatus,
      fulfillmentStatus: this.fulfillmentStatus,
      shippingAmount: Number(this.shippingAmount || 0),
      subtotalAmount: this.subtotalAmount,
      taxAmount: this.taxAmount,
      discountAmount: this.discountAmount,
      totalAmount: this.totalAmount,
      notes: this.notes.trim() || undefined,
      salesInvoiceId,
      salesInvoiceIssueDate: this.completionSalesInvoiceIssueDate || this.todayIsoDate(),
    };

    this.submitOrderUpdate(payload);
  }

  private submitOrderUpdate(payload: Record<string, unknown>): void {
    this.saving = true;
    this.error = '';
    this.message = '';
    this.completionModalError = '';

    this.api.update<OrderRow>('/api/v1/orders', this.orderId, payload).subscribe({
      next: (response) => {
        this.saving = false;
        this.showCompleteModal = false;
        this.completionSalesInvoiceId = '';
        this.completionSalesInvoiceIssueDate = '';
        this.completionModalError = '';
        this.message = response.message || 'Order updated successfully.';
        this.loadOrder();
      },
      error: (err) => {
        this.saving = false;
        const message = err?.error?.message || 'Unable to update order.';
        if (this.showCompleteModal) {
          this.completionModalError = message;
          return;
        }
        this.error = message;
      },
    });
  }

  customerLabel(row: CustomerRow): string {
    return `${row.name} (${row.taxId})`;
  }

  printOrder(): void {
    window.print();
  }

  private todayIsoDate(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
