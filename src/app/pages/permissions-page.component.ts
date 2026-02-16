import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { ConfirmDialogService } from '../core/confirm-dialog.service';
import { ApiResponse } from '../core/types';
import { TooltipDirective } from '../shared/tooltip.directive';

interface PermissionRow {
  id: string;
  name: string;
  code: string;
  resource: string;
  action: string;
  description?: string;
  isSystem?: boolean;
  isActive?: boolean;
}

@Component({
  selector: 'app-permissions-page',
  standalone: true,
  imports: [CommonModule, FormsModule, TooltipDirective],
  templateUrl: './permissions-page.component.html',
})
export class PermissionsPageComponent {
  private readonly api: ApiService;
  private readonly confirmDialog = inject(ConfirmDialogService);

  constructor(api: ApiService) {
    this.api = api;
  }

  readonly rows = signal<PermissionRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly isCreateModalOpen = signal(false);

  readonly message = signal('');
  readonly error = signal('');
  readonly filter = signal('');
  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
  readonly pageSizeOptions = [10, 20, 50, 100];
        viewMode: 'table' | 'card' = 'table';

  createForm: Record<string, unknown> = {
    name: '',
    code: '',
    resource: '',
    action: '',
    description: '',
    isSystem: false,
    isActive: true,
  };

  editingId = '';
  editForm: Record<string, unknown> = {
    name: '',
    code: '',
    resource: '',
    action: '',
    description: '',
    isSystem: false,
    isActive: true,
  };

  readonly filteredRows = computed(() => {
    const q = this.filter().trim().toLowerCase();
    if (!q) {
      return this.rows();
    }

    return this.rows().filter((row) => {
      return (
        row.name?.toLowerCase().includes(q) ||
        row.code?.toLowerCase().includes(q) ||
        row.resource?.toLowerCase().includes(q) ||
        row.action?.toLowerCase().includes(q) ||
        String(row.description || '').toLowerCase().includes(q)
      );
    });
  });

  ngOnInit(): void {
    this.load();
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

    this.api.list<PermissionRow>(`/api/v1/permissions?${params.toString()}`).subscribe({
      next: (response: ApiResponse<PermissionRow[]>) => {
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
        this.error.set(err?.error?.message || 'Unable to load permissions.');
      },
    });
  }

  openCreateModal(): void {
    this.createForm = {
      name: '',
      code: '',
      resource: '',
      action: '',
      description: '',
      isSystem: false,
      isActive: true,
    };
    this.error.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  createPermission(): void {
    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const payload = {
      name: String(this.createForm['name'] || '').trim(),
      code: String(this.createForm['code'] || '').trim().toLowerCase(),
      resource: String(this.createForm['resource'] || '').trim().toLowerCase(),
      action: String(this.createForm['action'] || '').trim().toLowerCase(),
      description: String(this.createForm['description'] || '').trim() || undefined,
      isSystem: Boolean(this.createForm['isSystem']),
      isActive: Boolean(this.createForm['isActive']),
    };

    this.api.create<PermissionRow>('/api/v1/permissions', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'Permission created successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to create permission.');
      },
    });
  }

  startEdit(row: PermissionRow): void {
    this.editingId = row.id;
    this.editForm = {
      name: row.name || '',
      code: row.code || '',
      resource: row.resource || '',
      action: row.action || '',
      description: row.description || '',
      isSystem: Boolean(row.isSystem),
      isActive: row.isActive !== false,
    };
  }

  cancelEdit(): void {
    this.editingId = '';
  }

  async saveEdit(): Promise<void> {
    if (!this.editingId) {
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: 'Update Permission',
      message: 'Save changes to this permission?',
      confirmText: 'Update Permission',
      confirmButtonClass: 'btn-primary',
      iconClass: 'bi-pencil-square',
    });
    if (!confirmed) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const payload = {
      name: String(this.editForm['name'] || '').trim(),
      code: String(this.editForm['code'] || '').trim().toLowerCase(),
      resource: String(this.editForm['resource'] || '').trim().toLowerCase(),
      action: String(this.editForm['action'] || '').trim().toLowerCase(),
      description: String(this.editForm['description'] || '').trim() || undefined,
      isSystem: Boolean(this.editForm['isSystem']),
      isActive: Boolean(this.editForm['isActive']),
    };

    this.api.update<PermissionRow>('/api/v1/permissions', this.editingId, payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.message.set(response.message || 'Permission updated successfully.');
        this.editingId = '';
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to update permission.');
      },
    });
  }

  async removePermission(id: string): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Permission',
      message: 'Delete this permission? This action cannot be undone.',
      confirmText: 'Delete Permission',
      confirmButtonClass: 'btn-danger',
      iconClass: 'bi-key',
    });
    if (!confirmed) {
      return;
    }
    this.deletingId.set(id);
    this.error.set('');
    this.message.set('');

    this.api.remove('/api/v1/permissions', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'Permission deleted successfully.');
        this.load();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete permission.');
      },
    });
  }

  trackById(_index: number, row: PermissionRow): string {
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
}
