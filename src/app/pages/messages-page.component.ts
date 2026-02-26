import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { OrganizationContextService } from '../core/organization-context.service';
import { ApiResponse } from '../core/types';

interface MessageRow {
  id: string;
  organizationId: string;
  entityType?: string;
  entityId?: string | null;
  title: string;
  message: string;
  isRead?: boolean;
  readAt?: string | null;
  createdAt?: string;
  creator?: {
    id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  };
}

@Component({
  selector: 'app-messages-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './messages-page.component.html',
})
export class MessagesPageComponent {
  private readonly api = inject(ApiService);
  private readonly organizationContext = inject(OrganizationContextService);

  readonly rows = signal<MessageRow[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly message = signal('');

  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
  isReadFilter = '';
  query = '';
  showOrganizationWarningModal = false;

  get isSuperuser(): boolean {
    return this.organizationContext.isSuperuser();
  }

  get currentOrganizationId(): string {
    return String(this.organizationContext.getActiveOrganizationId() || '').trim();
  }

  get hasOrganizationContext(): boolean {
    return Boolean(this.currentOrganizationId);
  }

  get isContextLocked(): boolean {
    return this.isSuperuser && !this.hasOrganizationContext;
  }

  ngOnInit(): void {
    this.showOrganizationWarningModal = this.isContextLocked;
    this.load();
  }

  closeOrganizationWarningModal(): void {
    this.showOrganizationWarningModal = false;
  }

  load(): void {
    if (this.isContextLocked) {
      this.loading.set(false);
      this.error.set('');
      this.rows.set([]);
      this.total = 0;
      this.totalPages = 1;
      this.page = 1;
      return;
    }
    this.loading.set(true);
    this.error.set('');
    const params = new URLSearchParams({
      page: String(this.page),
      limit: String(this.pageSize),
    });
    if (this.currentOrganizationId) {
      params.set('organizationId', this.currentOrganizationId);
    }
    if (this.isReadFilter === 'read') {
      params.set('isRead', 'true');
    } else if (this.isReadFilter === 'unread') {
      params.set('isRead', 'false');
    }
    const q = this.query.trim();
    if (q) {
      params.set('q', q);
    }

    this.api.list<MessageRow>(`/api/v1/messages?${params.toString()}`).subscribe({
      next: (response: ApiResponse<MessageRow[]>) => {
        this.loading.set(false);
        this.rows.set(response.data || []);
        const meta = response.meta || {};
        this.total = Number(meta.total || 0);
        this.totalPages = Math.max(1, Number(meta.totalPages || 1));
        this.page = Math.max(1, Number(meta.page || this.page));
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Unable to load messages.');
      },
    });
  }

  applyFilters(): void {
    if (this.isContextLocked) return;
    this.page = 1;
    this.load();
  }

  onPageSizeChange(value: string): void {
    if (this.isContextLocked) return;
    const parsed = Number(value);
    this.pageSize = Number.isFinite(parsed) ? parsed : 20;
    this.page = 1;
    this.load();
  }

  goToPage(page: number): void {
    if (this.isContextLocked || page < 1 || page > this.totalPages || page === this.page || this.loading()) {
      return;
    }
    this.page = page;
    this.load();
  }

  markAsRead(row: MessageRow): void {
    if (this.isContextLocked) return;
    if (!row?.id || row.isRead) {
      return;
    }
    this.api.put<MessageRow>(`/api/v1/messages/${row.id}/read`, {}).subscribe({
      next: () => {
        this.rows.set(
          this.rows().map((item) =>
            item.id === row.id
              ? { ...item, isRead: true, readAt: new Date().toISOString() }
              : item
          )
        );
        this.message.set('Message marked as read.');
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'Unable to mark message as read.');
      },
    });
  }

  formatTimestamp(value?: string): string {
    if (!value) {
      return '-';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }
    return date.toLocaleString();
  }

  creatorLabel(row: MessageRow): string {
    const creator = row.creator;
    const name = [creator?.firstName, creator?.lastName].filter(Boolean).join(' ').trim();
    return name || creator?.email || '-';
  }

  entityTypeLabel(value: unknown): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return '-';
    }
    return normalized.replace(/_/g, ' ');
  }

  trackById(_index: number, row: MessageRow): string {
    return row.id;
  }
}
