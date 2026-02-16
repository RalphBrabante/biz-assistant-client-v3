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
  type?: string;
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

interface OrderActivityRow {
  id: string;
  actionType?: string;
  title?: string;
  description?: string;
  changedFields?: string[];
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  actor?: {
    id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  };
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
  subtotalAmount?: number;
  taxAmount?: number;
  withHoldingTaxAmount?: number;
  withholdingTaxTypeId?: string | null;
  discountAmount?: number;
  totalAmount?: number;
  shippingAmount?: number;
  notes?: string;
  orderedItemSnapshots?: OrderSnapshotRow[];
  activities?: OrderActivityRow[];
  withholdingTaxType?: {
    id: string;
    code?: string;
    name?: string;
    percentage?: number;
    appliesTo?: 'expense' | 'invoice' | 'both';
  };
}

interface CartItem {
  item: ItemRow;
  quantity: number;
}

interface WithholdingTaxTypeOption {
  id: string;
  code?: string;
  name?: string;
  percentage?: number;
  appliesTo?: 'expense' | 'invoice' | 'both';
  isActive?: boolean;
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
  catalogHasMore = false;
  catalogLoadingMore = false;
  private catalogCurrentLimit = 10;
  private readonly catalogInitialLimit = 10;
  private readonly catalogLoadMoreStep = 5;
  private catalogLookup = new Map<string, ItemRow>();
  catalogLoading = false;
  cart: CartItem[] = [];
  showCompleteModal = false;
  completionSalesInvoiceId = '';
  completionSalesInvoiceIssueDate = '';
  completionModalError = '';
  organizationVatRate = 0;
  applyWithholdingTax = false;
  withholdingTaxTypeId = '';
  withholdingTaxTypes: WithholdingTaxTypeOption[] = [];
  loadingWithholdingTaxTypes = false;
  activityVisibleCount = 3;

  ngOnInit(): void {
    this.orderId = String(this.route.snapshot.paramMap.get('id') || '');
    if (!this.orderId) {
      this.showError('Order ID is missing.');
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
    this.activityVisibleCount = 3;
    // Keep item search pane intentionally empty until user searches (prevents noisy initial list).
    this.catalogItems = [];
    this.catalogHasMore = false;
    this.catalogLoadingMore = false;
    this.catalogCurrentLimit = this.catalogInitialLimit;

    this.api.get<OrderRow>(`/api/v1/orders/${this.orderId}`).subscribe({
      next: (response: ApiResponse<OrderRow>) => {
        this.loading = false;
        const order = response.data || null;
        this.order = order;
        if (!order) {
          this.showError('Order not found.');
          return;
        }

        this.status = String(order.status || 'pending');
        this.paymentStatus = String(order.paymentStatus || 'unpaid');
        this.fulfillmentStatus = String(order.fulfillmentStatus || 'unfulfilled');
        this.shippingAmount = Number(order.shippingAmount || 0);
        this.notes = String(order.notes || '');
        this.applyWithholdingTax = Boolean(order.withholdingTaxTypeId);
        this.withholdingTaxTypeId = String(order.withholdingTaxTypeId || '');
        this.selectedCustomerId = String(order.customerId || order.customer?.id || '');
        this.customerResults = order.customer ? [{ id: order.customer.id, organizationId: order.organizationId, name: order.customer.name || '', taxId: order.customer.taxId || '' }] : [];

        this.loadOrganizationTaxRate();
        this.loadWithholdingTaxTypes();
        this.loadItemsForOrganization();
      },
      error: (err) => {
        this.loading = false;
        this.showError(err?.error?.message || 'Unable to load order.');
      },
    });
  }

  loadOrganizationTaxRate(): void {
    if (!this.organizationId) {
      this.organizationVatRate = 0;
      return;
    }

    this.api.get<{ taxType?: { percentage?: number } }>(`/api/v1/organizations/${this.organizationId}`).subscribe({
      next: (response) => {
        const percentage = Number(response.data?.taxType?.percentage ?? NaN);
        if (Number.isFinite(percentage) && percentage > 0) {
          this.organizationVatRate = Number(percentage.toFixed(2));
          return;
        }
        this.organizationVatRate = this.derivedVatRateFromOrder();
      },
      error: () => {
        this.organizationVatRate = this.derivedVatRateFromOrder();
      },
    });
  }

  loadItemsForOrganization(): void {
    if (!this.organizationId) return;

    this.catalogLoading = true;
    this.api.list<ItemRow>(`/api/v1/items?organizationId=${encodeURIComponent(this.organizationId)}&isActive=true&limit=300`).subscribe({
      next: (response: ApiResponse<ItemRow[]>) => {
        this.catalogLoading = false;
        const allItems = response.data || [];
        this.catalogLookup = new Map(allItems.map((item) => [item.id, item]));
        this.catalogItems = [];
        this.catalogHasMore = false;
        this.catalogCurrentLimit = this.catalogInitialLimit;
        this.initializeCartFromOrder();
      },
      error: (err) => {
        this.catalogLoading = false;
        this.showError(err?.error?.message || 'Unable to load items catalog.');
      },
    });
  }

  initializeCartFromOrder(): void {
    const snapshots = this.order?.orderedItemSnapshots || [];
    const byId = this.catalogLookup;
    this.cart = snapshots
      .map((row) => {
        const itemId = String(row.itemId || '');
        if (!itemId) return null;
        // Prefer live catalog row; fallback to snapshot-derived stub so historical rows always render.
        const item =
          byId.get(itemId) ||
          ({
            id: itemId,
            organizationId: this.organizationId,
            type: row.type || 'product',
            name: row.name || 'Unknown Item',
            sku: row.sku || '',
            price: Number(row.unitPrice ?? 0),
            discountedPrice: Number(row.discountedUnitPrice ?? row.unitPrice ?? 0),
            currency: row.currency || this.orderCurrency,
            stock: 0,
            isActive: true,
          } as ItemRow);
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
      this.showError('Order organization is missing.');
      return;
    }

    this.catalogLoading = true;
    this.error = '';
    // Reset to the first chunk for each new query (10 initial, then +5 via loadMoreItems).
    this.catalogCurrentLimit = this.catalogInitialLimit;
    const q = encodeURIComponent(this.itemSearchQuery.trim());
    this.api
      .list<ItemRow>(
        `/api/v1/items?organizationId=${encodeURIComponent(this.organizationId)}&q=${q}&isActive=true&page=1&limit=${this.catalogCurrentLimit}`
      )
      .subscribe({
        next: (response: ApiResponse<ItemRow[]>) => {
          this.catalogLoading = false;
          const rows = response.data || [];
          this.catalogItems = rows;
          const total = Number(response.meta?.total || rows.length);
          this.catalogHasMore = this.catalogItems.length < total;
        },
        error: (err) => {
          this.catalogLoading = false;
          this.catalogHasMore = false;
          this.catalogItems = [];
          this.showError(err?.error?.message || 'Unable to search items.');
        },
      });
  }

  loadMoreItems(): void {
    if (this.isLocked || this.catalogLoading || this.catalogLoadingMore || !this.catalogHasMore) {
      return;
    }

    this.catalogLoadingMore = true;
    this.error = '';
    // Uses growing limit on page 1 so previously loaded cards keep order and avoid duplicates.
    this.catalogCurrentLimit += this.catalogLoadMoreStep;
    const q = encodeURIComponent(this.itemSearchQuery.trim());
    this.api
      .list<ItemRow>(
        `/api/v1/items?organizationId=${encodeURIComponent(this.organizationId)}&q=${q}&isActive=true&page=1&limit=${this.catalogCurrentLimit}`
      )
      .subscribe({
        next: (response: ApiResponse<ItemRow[]>) => {
          this.catalogLoadingMore = false;
          const rows = response.data || [];
          this.catalogItems = rows;
          const total = Number(response.meta?.total || rows.length);
          this.catalogHasMore = this.catalogItems.length < total;
        },
        error: (err) => {
          this.catalogLoadingMore = false;
          this.showError(err?.error?.message || 'Unable to load more items.');
        },
      });
  }

  searchCustomers(): void {
    if (this.isLocked) return;
    if (!this.organizationId) {
      this.showError('Order organization is missing.');
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
        this.showError(err?.error?.message || 'Unable to search customers.');
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

  updateQuantity(itemId: string, value: unknown): void {
    if (this.isLocked) return;
    const entry = this.cart.find((row) => row.item.id === itemId);
    if (!entry) {
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return;
    }

    let nextQuantity = Math.trunc(parsed);
    if (nextQuantity < 1) {
      nextQuantity = 1;
    }

    if (entry.item.type === 'product') {
      const availableStock = this.maxStock(entry.item);
      if (availableStock <= 0) {
        this.message = `${entry.item.name} is currently out of stock.`;
      } else if (nextQuantity > availableStock) {
        this.message = `Quantity for ${entry.item.name} exceeds available stock (${availableStock}).`;
      }
    }

    entry.quantity = nextQuantity;
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
    const computed = Number(subtotal.toFixed(2));
    if (computed > 0) return computed;
    return Number(Number(this.order?.subtotalAmount || 0).toFixed(2));
  }

  get taxableAmount(): number {
    const rate = Number(this.organizationVatRate || 0);
    if (rate <= 0) {
      return this.subtotalAmount;
    }
    return Number((this.subtotalAmount / (1 + rate / 100)).toFixed(2));
  }

  get taxAmount(): number {
    const rate = Number(this.organizationVatRate || 0);
    if (rate <= 0) {
      return Number(Number(this.order?.taxAmount || 0).toFixed(2));
    }
    const computed = Number((this.taxableAmount * (rate / 100)).toFixed(2));
    if (computed > 0) return computed;
    return Number(Number(this.order?.taxAmount || 0).toFixed(2));
  }

  get discountAmount(): number {
    const discount = this.cart.reduce((acc, row) => {
      const full = Number(row.item.price ?? 0) * row.quantity;
      const effective = this.itemUnitPrice(row.item) * row.quantity;
      return acc + Math.max(0, full - effective);
    }, 0);
    const computed = Number(discount.toFixed(2));
    if (computed > 0) return computed;
    return Number(Number(this.order?.discountAmount || 0).toFixed(2));
  }

  get totalAmount(): number {
    return Number((this.subtotalAmount + Number(this.shippingAmount || 0) - this.withHoldingTaxAmount).toFixed(2));
  }

  get selectedWithholdingTaxType(): WithholdingTaxTypeOption | undefined {
    return this.withholdingTaxTypes.find((row) => row.id === this.withholdingTaxTypeId);
  }

  get withHoldingTaxAmount(): number {
    if (!this.applyWithholdingTax || !this.withholdingTaxTypeId) {
      return 0;
    }
    const percentage = Number(this.selectedWithholdingTaxType?.percentage || 0);
    if (!Number.isFinite(percentage) || percentage <= 0) {
      return 0;
    }
    // UI mirrors backend rule: withholding is a percentage of taxable amount.
    return Number((this.taxableAmount * (percentage / 100)).toFixed(2));
  }

  get selectedCustomer(): CustomerRow | undefined {
    return this.customerResults.find((row) => row.id === this.selectedCustomerId);
  }

  get deliveryLines(): OrderSnapshotRow[] {
    return this.order?.orderedItemSnapshots || [];
  }

  get activityHistory(): OrderActivityRow[] {
    return this.order?.activities || [];
  }

  get visibleActivityHistory(): OrderActivityRow[] {
    return this.activityHistory.slice(0, this.activityVisibleCount);
  }

  get hasMoreActivities(): boolean {
    return this.activityVisibleCount < this.activityHistory.length;
  }

  get printProductLines(): OrderSnapshotRow[] {
    return this.deliveryLines.filter((line) => {
      const snapshotType = String(line.type || '').toLowerCase();
      if (snapshotType) {
        return snapshotType === 'product';
      }
      const catalogType = String(this.catalogLookup.get(String(line.itemId || ''))?.type || '').toLowerCase();
      return catalogType === 'product';
    });
  }

  get deliverySubtotal(): number {
    const value = this.deliveryLines.reduce((acc, row) => acc + Number(row.lineSubtotal || 0), 0);
    return Number(value.toFixed(2));
  }

  get deliveryTax(): number {
    const value = this.deliveryLines.reduce((acc, row) => acc + Number(row.lineTax || 0), 0);
    const computed = Number(value.toFixed(2));
    if (computed > 0) return computed;
    return Number(Number(this.order?.taxAmount || 0).toFixed(2));
  }

  get deliveryTaxable(): number {
    const taxable = this.deliverySubtotal - this.deliveryTax;
    return Number(Math.max(0, taxable).toFixed(2));
  }

  get deliveryDiscount(): number {
    const value = this.deliveryLines.reduce((acc, row) => acc + Number(row.lineDiscount || 0), 0);
    const computed = Number(value.toFixed(2));
    if (computed > 0) return computed;
    return Number(Number(this.order?.discountAmount || 0).toFixed(2));
  }

  get deliveryTotal(): number {
    const value = this.deliveryLines.reduce((acc, row) => acc + Number(row.lineTotal || 0), 0);
    const computed = Number((value + Number(this.shippingAmount || 0)).toFixed(2));
    if (computed > 0) return computed;
    return Number(Number(this.order?.totalAmount || 0).toFixed(2));
  }

  get printSubtotal(): number {
    const value = this.printProductLines.reduce((acc, row) => acc + Number(row.lineSubtotal || 0), 0);
    return Number(value.toFixed(2));
  }

  get printTax(): number {
    const value = this.printProductLines.reduce((acc, row) => acc + Number(row.lineTax || 0), 0);
    return Number(value.toFixed(2));
  }

  get printTaxable(): number {
    const taxable = this.printSubtotal - this.printTax;
    return Number(Math.max(0, taxable).toFixed(2));
  }

  get printDiscount(): number {
    const value = this.printProductLines.reduce((acc, row) => acc + Number(row.lineDiscount || 0), 0);
    return Number(value.toFixed(2));
  }

  get printTotal(): number {
    const value = this.printProductLines.reduce((acc, row) => acc + Number(row.lineTotal || 0), 0);
    return Number((value + Number(this.shippingAmount || 0)).toFixed(2));
  }

  async saveOrder(): Promise<void> {
    if (this.isCompleted) {
      this.showError('Completed orders are locked and can no longer be edited.');
      return;
    }
    if (!this.orderId) return;
    if (!this.selectedCustomerId) {
      this.showError('Please select a customer.');
      return;
    }
    if (this.cart.length === 0) {
      this.showError('Order must have at least one item.');
      return;
    }
    const invalidStockEntry = this.cart.find(
      (row) => row.item.type === 'product' && row.quantity > this.maxStock(row.item)
    );
    if (invalidStockEntry) {
      this.showError(`Quantity for ${invalidStockEntry.item.name} exceeds available stock (${this.maxStock(invalidStockEntry.item)}).`);
      return;
    }

    this.error = '';
    this.message = '';

    // Send full financial fields; API still recomputes totals server-side for final source of truth.
    const payload: Record<string, unknown> = {
      customerId: this.selectedCustomerId,
      status: this.status,
      paymentStatus: this.paymentStatus,
      fulfillmentStatus: this.fulfillmentStatus,
      shippingAmount: Number(this.shippingAmount || 0),
      subtotalAmount: this.subtotalAmount,
      taxAmount: this.taxAmount,
      withHoldingTaxAmount: this.withHoldingTaxAmount,
      withholdingTaxTypeId: this.applyWithholdingTax && this.withholdingTaxTypeId ? this.withholdingTaxTypeId : null,
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

    const confirmed = await this.confirmDialog.confirm({
      title: 'Update Order',
      message: 'Save changes to this order?',
      confirmText: 'Update Order',
      confirmButtonClass: 'btn-primary',
      iconClass: 'bi-pencil-square',
    });
    if (!confirmed) {
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
      withHoldingTaxAmount: this.withHoldingTaxAmount,
      withholdingTaxTypeId: this.applyWithholdingTax && this.withholdingTaxTypeId ? this.withholdingTaxTypeId : null,
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
        this.showError(message);
      },
    });
  }

  customerLabel(row: CustomerRow): string {
    return `${row.name} (${row.taxId})`;
  }

  onApplyWithholdingTaxChange(): void {
    if (!this.applyWithholdingTax) {
      this.withholdingTaxTypeId = '';
    }
  }

  get orderCurrency(): string {
    const snapshots = this.order?.orderedItemSnapshots || [];
    return String(snapshots[0]?.currency || 'USD').toUpperCase();
  }

  exceedsStock(row: CartItem): boolean {
    return row.item.type === 'product' && row.quantity > this.maxStock(row.item);
  }

  printOrder(): void {
    window.print();
  }

  private todayIsoDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private derivedVatRateFromOrder(): number {
    const subtotal = Number(this.order?.subtotalAmount || 0);
    const tax = Number(this.order?.taxAmount || 0);
    const taxable = subtotal - tax;
    if (subtotal > 0 && tax > 0 && taxable > 0) {
      return Number(((tax / taxable) * 100).toFixed(2));
    }
    const snapshotRate = Number(this.order?.orderedItemSnapshots?.[0]?.taxRate ?? 0);
    return Number.isFinite(snapshotRate) && snapshotRate > 0 ? Number(snapshotRate.toFixed(2)) : 0;
  }

  private loadWithholdingTaxTypes(): void {
    if (!this.organizationId) {
      this.withholdingTaxTypes = [];
      return;
    }
    this.loadingWithholdingTaxTypes = true;
    this.api
      .list<WithholdingTaxTypeOption>(
        `/api/v1/withholding-tax-types?organizationId=${encodeURIComponent(this.organizationId)}&activeOnly=true`
      )
      .subscribe({
        next: (response) => {
          this.loadingWithholdingTaxTypes = false;
          this.withholdingTaxTypes = response.data || [];
        },
        error: () => {
          this.loadingWithholdingTaxTypes = false;
          this.withholdingTaxTypes = [];
        },
      });
  }

  activityBadgeClass(actionType: string | undefined): string {
    const normalized = String(actionType || '').toLowerCase();
    if (normalized === 'status_changed' || normalized === 'order_completed') {
      return 'text-bg-success';
    }
    if (normalized === 'inventory_deducted') {
      return 'text-bg-warning';
    }
    if (normalized === 'sales_invoice_created') {
      return 'text-bg-primary';
    }
    return 'text-bg-secondary';
  }

  activityIcon(actionType: string | undefined): string {
    const normalized = String(actionType || '').toLowerCase();
    if (normalized === 'order_created') return 'bi-plus-circle';
    if (normalized === 'order_updated') return 'bi-pencil-square';
    if (normalized === 'status_changed') return 'bi-arrow-left-right';
    if (normalized === 'inventory_deducted') return 'bi-box-seam';
    if (normalized === 'sales_invoice_created') return 'bi-file-earmark-check';
    return 'bi-clock-history';
  }

  actorLabel(activity: OrderActivityRow): string {
    const actor = activity.actor;
    if (!actor) return 'System';
    const fullName = [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim();
    return fullName || actor.email || 'System';
  }

  showMoreActivities(): void {
    this.activityVisibleCount += 3;
  }

  private showError(message: string): void {
    this.error = message;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
