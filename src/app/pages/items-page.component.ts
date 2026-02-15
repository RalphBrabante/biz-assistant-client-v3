import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ApiResponse } from '../core/types';
import { TooltipDirective } from '../shared/tooltip.directive';

interface ItemRow {
  id: string;
  organizationId: string;
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
  type?: string;
  sku?: string;
  name: string;
  description?: string;
  category?: string;
  unit?: string;
  price?: number;
  discountedPrice?: number;
  currency?: string;
  stock?: number;
  reorderLevel?: number;
  taxRate?: number;
  isActive?: boolean;
  createdBy?: string;
  updatedBy?: string;
}

interface OrganizationOption {
  id: string;
  name?: string;
  legalName?: string;
}

@Component({
  selector: 'app-items-page',
  standalone: true,
  imports: [CommonModule, FormsModule, TooltipDirective],
  templateUrl: './items-page.component.html',
})
export class ItemsPageComponent {
  private readonly api: ApiService;
  private readonly auth: AuthService;

  constructor(api: ApiService, auth: AuthService) {
    this.api = api;
    this.auth = auth;
  }

  readonly rows = signal<ItemRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly isCreateModalOpen = signal(false);
  readonly isEditModalOpen = signal(false);
  readonly organizations = signal<OrganizationOption[]>([]);

  readonly message = signal('');
  readonly error = signal('');
  readonly filter = signal('');
  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
  readonly pageSizeOptions = [10, 20, 50, 100];

  createForm: Record<string, unknown> = this.newItemForm();

  editingId = '';
  editForm: Record<string, unknown> = this.newItemForm();

  get currentOrganizationId(): string {
    return this.auth.currentUser()?.organizationId || '';
  }

  ngOnInit(): void {
    this.load();
    this.loadOrganizations();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const q = this.filter().trim();
    const params = new URLSearchParams({
      page: String(this.page),
      limit: String(this.pageSize),
    });
    if (q) {
      params.set('q', q);
    }

    this.api.list<ItemRow>(`/api/v1/items?${params.toString()}`).subscribe({
      next: (response: ApiResponse<ItemRow[]>) => {
        this.loading.set(false);
        this.rows.set(response.data || []);
        const meta = response.meta || {};
        this.total = Number(meta.total || 0);
        this.totalPages = Math.max(1, Number(meta.totalPages || 1));
        this.page = Math.max(1, Number(meta.page || this.page));
        this.pageSize = Math.max(1, Number(meta.limit || this.pageSize));

        if (this.page > this.totalPages) {
          this.page = this.totalPages;
          this.load();
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Unable to load items.');
      },
    });
  }

  loadOrganizations(): void {
    this.api.list<OrganizationOption>('/api/v1/organizations?limit=200').subscribe({
      next: (response: ApiResponse<OrganizationOption[]>) => {
        this.organizations.set(response.data || []);
      },
      error: () => {
        this.organizations.set([]);
      },
    });
  }

  openCreateModal(): void {
    this.createForm = {
      ...this.newItemForm(),
      organizationId: this.currentOrganizationId,
    };
    this.error.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  createItem(): void {
    if (!this.currentOrganizationId.trim()) {
      this.error.set('Logged in user has no organization assigned.');
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const payload = this.buildPayload({
      ...this.createForm,
      organizationId: this.currentOrganizationId,
    });

    this.api.create<ItemRow>('/api/v1/items', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'Item created successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to create item.');
      },
    });
  }

  openEditModal(row: ItemRow): void {
    this.editingId = row.id;
    this.editForm = {
      organizationId: row.organizationId || '',
      type: row.type || '',
      sku: row.sku || '',
      name: row.name || '',
      description: row.description || '',
      category: row.category || '',
      unit: row.unit || '',
      price: row.price ?? 0,
      discountedPrice: row.discountedPrice ?? 0,
      currency: row.currency || 'USD',
      stock: row.stock ?? 0,
      reorderLevel: row.reorderLevel ?? 0,
      taxRate: row.taxRate ?? 0,
      isActive: row.isActive !== false,
      createdBy: row.createdBy || '',
      updatedBy: row.updatedBy || '',
    };
    this.error.set('');
    this.message.set('');
    this.isEditModalOpen.set(true);
  }

  closeEditModal(): void {
    this.editingId = '';
    this.editForm = this.newItemForm();
    this.isEditModalOpen.set(false);
  }

  saveEdit(): void {
    if (!this.editingId) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const payload = this.buildPayload(this.editForm);

    this.api.update<ItemRow>('/api/v1/items', this.editingId, payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.message.set(response.message || 'Item updated successfully.');
        this.closeEditModal();
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to update item.');
      },
    });
  }

  removeItem(id: string): void {
    this.deletingId.set(id);
    this.error.set('');
    this.message.set('');

    this.api.remove('/api/v1/items', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'Item deleted successfully.');
        this.load();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete item.');
      },
    });
  }

  trackById(_index: number, row: ItemRow): string {
    return row.id;
  }

  onFilterChange(value: string): void {
    this.filter.set(value);
    this.page = 1;
    this.load();
  }

  onPageSizeChange(value: string): void {
    const parsed = Number(value);
    this.pageSize = Number.isFinite(parsed) ? parsed : 20;
    this.page = 1;
    this.load();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.page || this.loading()) {
      return;
    }
    this.page = page;
    this.load();
  }

  organizationLabel(row: ItemRow): string {
    if (row.organization?.name) {
      return row.organization.name;
    }
    if (row.organization?.legalName) {
      return row.organization.legalName;
    }
    return this.organizationOptionLabelById(row.organizationId) || row.organizationId || '-';
  }

  itemTypeBadgeClass(type: string | undefined): string {
    switch (String(type || '').toLowerCase()) {
      case 'product':
        return 'text-bg-primary';
      case 'service':
        return 'text-bg-info';
      default:
        return 'text-bg-secondary';
    }
  }

  itemActiveBadgeClass(isActive: boolean | undefined): string {
    return isActive ? 'text-bg-success' : 'text-bg-secondary';
  }

  itemStockBadgeClass(row: ItemRow): string {
    const stock = Math.max(0, Number(row.stock ?? 0));
    const reorderLevel = Math.max(0, Number(row.reorderLevel ?? 0));
    const lowStockThreshold = reorderLevel > 0 ? reorderLevel : 5;

    if (stock === 0) {
      return 'text-bg-danger';
    }
    if (stock <= lowStockThreshold) {
      return 'text-bg-warning';
    }
    return 'text-bg-success';
  }

  organizationOptionLabel(org: OrganizationOption): string {
    return org.name || org.legalName || org.id;
  }

  get currentOrganizationName(): string {
    return this.organizationOptionLabelById(this.currentOrganizationId) || 'Unknown organization';
  }

  private newItemForm(): Record<string, unknown> {
    return {
      organizationId: '',
      type: 'product',
      sku: '',
      name: '',
      description: '',
      category: '',
      unit: 'pcs',
      price: 0,
      discountedPrice: 0,
      currency: 'USD',
      stock: 0,
      reorderLevel: 0,
      taxRate: 0,
      isActive: true,
      createdBy: '',
      updatedBy: '',
    };
  }

  private buildPayload(form: Record<string, unknown>): Record<string, unknown> {
    return {
      organizationId: this.asString(form['organizationId']),
      type: this.optionalString(form['type']),
      sku: this.optionalString(form['sku']),
      name: this.asString(form['name']),
      description: this.optionalString(form['description']),
      category: this.optionalString(form['category']),
      unit: this.optionalString(form['unit']),
      price: this.optionalNumber(form['price']),
      discountedPrice: this.optionalNumber(form['discountedPrice']),
      currency: this.optionalString(form['currency']),
      stock: this.optionalNumber(form['stock']),
      reorderLevel: this.optionalNumber(form['reorderLevel']),
      taxRate: this.optionalNumber(form['taxRate']),
      isActive: Boolean(form['isActive']),
      createdBy: this.optionalString(form['createdBy']),
      updatedBy: this.optionalString(form['updatedBy']),
    };
  }

  private organizationOptionLabelById(id: string): string | undefined {
    const match = this.organizations().find((org) => org.id === id);
    if (!match) {
      return undefined;
    }
    return this.organizationOptionLabel(match);
  }

  private asString(value: unknown): string {
    return String(value || '').trim();
  }

  private optionalString(value: unknown): string | undefined {
    const cleaned = String(value || '').trim();
    return cleaned ? cleaned : undefined;
  }

  private optionalNumber(value: unknown): number | undefined {
    if (value === '' || value === null || value === undefined) {
      return undefined;
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
}
