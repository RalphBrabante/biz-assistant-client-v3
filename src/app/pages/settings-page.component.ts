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

interface StorageSettingPayload {
  provider: 'local' | 'do_spaces';
  doSpaces: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    hasSecretKey: boolean;
    cdnBaseUrl: string;
    directory: string;
  };
  isDoSpacesConfigured: boolean;
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
  readonly storageProvider = signal<'local' | 'do_spaces'>('local');
  readonly doSpacesEndpoint = signal('');
  readonly doSpacesRegion = signal('');
  readonly doSpacesBucket = signal('');
  readonly doSpacesAccessKey = signal('');
  readonly doSpacesSecretKey = signal('');
  readonly doSpacesHasSecretKey = signal(false);
  readonly doSpacesCdnBaseUrl = signal('');
  readonly doSpacesDirectory = signal('');
  readonly doSpacesConfigured = signal(false);

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

    let pending = 2;
    const complete = () => {
      pending -= 1;
      if (pending <= 0) {
        this.loading.set(false);
      }
    };

    this.api.get<CacheSettingPayload>('/api/v1/settings/cache').subscribe({
      next: (response: ApiResponse<CacheSettingPayload>) => {
        this.cacheEnabled.set(Boolean(response.data?.enabled));
        complete();
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'Unable to load settings.');
        complete();
      },
    });

    this.api.get<StorageSettingPayload>('/api/v1/settings/storage').subscribe({
      next: (response: ApiResponse<StorageSettingPayload>) => {
        const data = response.data;
        this.storageProvider.set((data?.provider || 'local') as 'local' | 'do_spaces');
        this.doSpacesEndpoint.set(String(data?.doSpaces?.endpoint || ''));
        this.doSpacesRegion.set(String(data?.doSpaces?.region || ''));
        this.doSpacesBucket.set(String(data?.doSpaces?.bucket || ''));
        this.doSpacesAccessKey.set(String(data?.doSpaces?.accessKey || ''));
        this.doSpacesSecretKey.set('');
        this.doSpacesHasSecretKey.set(Boolean(data?.doSpaces?.hasSecretKey));
        this.doSpacesCdnBaseUrl.set(String(data?.doSpaces?.cdnBaseUrl || ''));
        this.doSpacesDirectory.set(String(data?.doSpaces?.directory || ''));
        this.doSpacesConfigured.set(Boolean(data?.isDoSpacesConfigured));
        complete();
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'Unable to load storage settings.');
        complete();
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
      message: 'Save platform settings changes?',
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

    let pending = 2;
    const complete = () => {
      pending -= 1;
      if (pending <= 0) {
        this.submitting.set(false);
      }
    };

    this.api
      .put<CacheSettingPayload>('/api/v1/settings/cache', {
        enabled: this.cacheEnabled(),
      })
      .subscribe({
        next: () => {
          complete();
        },
        error: (err) => {
          this.error.set(err?.error?.message || 'Unable to update cache setting.');
          complete();
        },
      });

    this.api
      .put<StorageSettingPayload>('/api/v1/settings/storage', {
        provider: this.storageProvider(),
        doSpaces: {
          endpoint: this.doSpacesEndpoint().trim(),
          region: this.doSpacesRegion().trim(),
          bucket: this.doSpacesBucket().trim(),
          accessKey: this.doSpacesAccessKey().trim(),
          secretKey: this.doSpacesSecretKey().trim(),
          cdnBaseUrl: this.doSpacesCdnBaseUrl().trim(),
          directory: this.doSpacesDirectory().trim(),
        },
      })
      .subscribe({
        next: (response) => {
          this.doSpacesHasSecretKey.set(Boolean(response.data?.doSpaces?.hasSecretKey));
          this.doSpacesConfigured.set(Boolean(response.data?.isDoSpacesConfigured));
          this.doSpacesSecretKey.set('');
          this.message.set(response.message || 'Settings updated successfully.');
          complete();
        },
        error: (err) => {
          this.error.set(err?.error?.message || 'Unable to update storage settings.');
          complete();
        },
      });
  }
}
