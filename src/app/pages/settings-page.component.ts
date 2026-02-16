import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ConfirmDialogService } from '../core/confirm-dialog.service';
import { ApiResponse } from '../core/types';

interface CacheSettingPayload {
  key: string;
  enabled: boolean;
}

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings-page.component.html',
})
export class SettingsPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);

  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly cacheEnabled = signal(true);

  get isSuperuser(): boolean {
    const roleCodes = (this.auth.currentUser()?.roleCodes || []).map((code) =>
      String(code || '').toLowerCase()
    );
    return roleCodes.includes('superuser');
  }

  ngOnInit(): void {
    this.loadSettings();
  }

  loadSettings(): void {
    if (!this.isSuperuser) {
      this.error.set('Only superuser can access cache settings.');
      return;
    }

    this.loading.set(true);
    this.error.set('');

    this.api.get<CacheSettingPayload>('/api/v1/settings/cache').subscribe({
      next: (response: ApiResponse<CacheSettingPayload>) => {
        this.loading.set(false);
        this.cacheEnabled.set(Boolean(response.data?.enabled));
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Unable to load settings.');
      },
    });
  }

  async save(): Promise<void> {
    if (!this.isSuperuser) {
      this.error.set('Only superuser can update cache settings.');
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: 'Update Settings',
      message: 'Save cache setting changes?',
      confirmText: 'Save Settings',
      confirmButtonClass: 'btn-primary',
      iconClass: 'bi-gear',
    });
    if (!confirmed) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    this.api
      .put<CacheSettingPayload>('/api/v1/settings/cache', {
        enabled: this.cacheEnabled(),
      })
      .subscribe({
        next: (response) => {
          this.submitting.set(false);
          this.message.set(response.message || 'Settings updated successfully.');
        },
        error: (err) => {
          this.submitting.set(false);
          this.error.set(err?.error?.message || 'Unable to update settings.');
        },
      });
  }
}
