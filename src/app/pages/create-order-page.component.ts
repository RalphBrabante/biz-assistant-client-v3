import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
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

interface CartItem {
  item: ItemRow;
  quantity: number;
}

interface CustomerRow {
  id: string;
  organizationId: string;
  name: string;
  taxId: string;
  legalName?: string;
  customerCode?: string;
  isActive?: boolean;
}

@Component({
  selector: 'app-create-order-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './create-order-page.component.html',
})
export class CreateOrderPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  orderNumber = this.generateOrderNumber();
  status = 'pending';
  paymentStatus = 'unpaid';
  fulfillmentStatus = 'unfulfilled';
  shippingAmount = 0;
  notes = '';

  searchQuery = '';
  customerSearchQuery = '';
  catalogItems: ItemRow[] = [];
  cart: CartItem[] = [];
  customerResults: CustomerRow[] = [];
  selectedCustomerId = '';
  searchingCustomers = false;
  customerSearchPerformed = false;
  customerSearchStatus = '';

  catalogLoading = false;
  submitting = false;
  error = '';
  message = '';

  get currentOrganizationId(): string {
    return this.auth.currentUser()?.organizationId || '';
  }

  get currentOrganizationCurrency(): string {
    return String(this.auth.currentUser()?.currency || 'USD').toUpperCase();
  }

  searchItems(): void {
    if (!this.currentOrganizationId.trim()) {
      this.error = 'Logged in user has no organization assigned.';
      return;
    }

    this.catalogLoading = true;
    this.error = '';

    const query = encodeURIComponent(this.searchQuery.trim());
    const orgId = encodeURIComponent(this.currentOrganizationId.trim());
    const endpoint = `/api/v1/items?organizationId=${orgId}&q=${query}&isActive=true&limit=100`;

    this.api.list<ItemRow>(endpoint).subscribe({
      next: (response: ApiResponse<ItemRow[]>) => {
        this.catalogLoading = false;
        this.catalogItems = (response.data || []).filter((item) => item.isActive !== false);
      },
      error: (err) => {
        this.catalogLoading = false;
        this.error = err?.error?.message || 'Unable to search items.';
      },
    });
  }

  searchCustomers(): void {
    if (!this.currentOrganizationId.trim()) {
      this.error = 'Logged in user has no organization assigned.';
      return;
    }

    this.searchingCustomers = true;
    this.customerSearchPerformed = true;
    this.customerSearchStatus = '';
    this.error = '';

    const query = encodeURIComponent(this.customerSearchQuery.trim());
    const orgId = encodeURIComponent(this.currentOrganizationId.trim());
    const endpoint = `/api/v1/customers?organizationId=${orgId}&q=${query}&isActive=true&limit=30`;

    this.api.list<CustomerRow>(endpoint).subscribe({
      next: (response: ApiResponse<CustomerRow[]>) => {
        this.searchingCustomers = false;
        this.customerResults = (response.data || []).filter((row) => row.isActive !== false);
        const count = this.customerResults.length;
        this.customerSearchStatus =
          count > 0
            ? `${count} customer${count > 1 ? 's' : ''} found. Please select one.`
            : 'No matching customers found.';
      },
      error: (err) => {
        this.searchingCustomers = false;
        this.customerResults = [];
        this.customerSearchStatus = 'Customer search failed.';
        this.error = err?.error?.message || 'Unable to search customers.';
      },
    });
  }

  get selectedCustomer(): CustomerRow | undefined {
    return this.customerResults.find((row) => row.id === this.selectedCustomerId);
  }

  addToCart(item: ItemRow): void {
    if (item.type === 'product' && !this.canIncreaseItem(item)) {
      this.message = `Cannot add more of ${item.name}. Reached available stock.`;
      return;
    }

    const existing = this.cart.find((entry) => entry.item.id === item.id);
    if (existing) {
      if (item.type === 'product') {
        const availableStock = this.maxStock(item);
        if (existing.quantity >= availableStock) {
          this.message = `Cannot add more of ${item.name}. Reached available stock (${availableStock}).`;
          return;
        }
      }
      existing.quantity += 1;
      return;
    }

    this.cart.push({ item, quantity: 1 });
  }

  increase(itemId: string): void {
    const entry = this.cart.find((row) => row.item.id === itemId);
    if (!entry) return;
    if (entry.item.type === 'product') {
      const availableStock = this.maxStock(entry.item);
      if (entry.quantity >= availableStock) {
        this.message = `Cannot add more of ${entry.item.name}. Reached available stock (${availableStock}).`;
        return;
      }
    }
    entry.quantity += 1;
  }

  decrease(itemId: string): void {
    const entry = this.cart.find((row) => row.item.id === itemId);
    if (!entry) return;

    entry.quantity -= 1;
    if (entry.quantity <= 0) {
      this.removeFromCart(itemId);
    }
  }

  removeFromCart(itemId: string): void {
    this.cart = this.cart.filter((row) => row.item.id !== itemId);
  }

  itemUnitPrice(item: ItemRow): number {
    const discounted = Number(item.discountedPrice ?? NaN);
    if (Number.isFinite(discounted) && discounted >= 0) {
      return discounted;
    }
    return Number(item.price ?? 0);
  }

  itemLineTotal(row: CartItem): number {
    const price = this.itemUnitPrice(row.item);
    const taxRate = Number(row.item.taxRate ?? 0);
    const subtotal = price * row.quantity;
    const tax = subtotal * (taxRate / 100);
    return Number((subtotal + tax).toFixed(2));
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
      const diff = full - effective;
      return acc + (diff > 0 ? diff : 0);
    }, 0);
    return Number(discount.toFixed(2));
  }

  get totalAmount(): number {
    const total = this.subtotalAmount + this.taxAmount + Number(this.shippingAmount || 0);
    return Number(total.toFixed(2));
  }

  placeOrder(): void {
    if (!this.currentOrganizationId.trim()) {
      this.error = 'Logged in user has no organization assigned.';
      return;
    }
    if (!this.orderNumber.trim()) {
      this.error = 'Order number is required.';
      return;
    }
    if (!this.selectedCustomerId.trim()) {
      this.error = 'Please select a customer for this order.';
      return;
    }
    if (this.cart.length === 0) {
      this.error = 'Add at least one item to place an order.';
      return;
    }

    const payload = {
      orderNumber: this.orderNumber.trim(),
      customerId: this.selectedCustomerId.trim(),
      source: 'web',
      status: this.status,
      paymentStatus: this.paymentStatus,
      fulfillmentStatus: this.fulfillmentStatus,
      currency: this.currentOrganizationCurrency,
      subtotalAmount: this.subtotalAmount,
      taxAmount: this.taxAmount,
      discountAmount: this.discountAmount,
      shippingAmount: Number(this.shippingAmount || 0),
      totalAmount: this.totalAmount,
      notes: this.notes.trim() || undefined,
      orderedItems: this.cart.map((row) => ({
        itemId: row.item.id,
        quantity: row.quantity,
        metadata: {
          uiPrice: this.itemUnitPrice(row.item),
          stockAtOrder: row.item.stock ?? null,
        },
      })),
    };

    this.submitting = true;
    this.error = '';
    this.message = '';

    this.api.create('/api/v1/orders', payload).subscribe({
      next: () => {
        this.submitting = false;
        void this.router.navigate(['/orders']);
      },
      error: (err) => {
        this.submitting = false;
        this.error = err?.error?.message || 'Unable to place order.';
      },
    });
  }

  private generateOrderNumber(): string {
    const stamp = Date.now();
    return `ORD-${stamp}`;
  }

  maxStock(item: ItemRow): number {
    return Math.max(0, Number(item.stock ?? 0));
  }

  canIncreaseItem(item: ItemRow): boolean {
    if (item.type !== 'product') {
      return true;
    }
    const entry = this.cart.find((row) => row.item.id === item.id);
    const qty = entry ? entry.quantity : 0;
    return qty < this.maxStock(item);
  }

  customerLabel(row: CustomerRow): string {
    return `${row.name} (${row.taxId})`;
  }
}
