import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ApiService } from '../core/api.service';
import { ApiResponse } from '../core/types';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard-page.component.html',
})
export class DashboardPageComponent {
  private readonly api = inject(ApiService);

  loading = false;
  error = '';
  health: Record<string, unknown> | null = null;

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.error = '';

    this.api.get<Record<string, unknown>>('/api/v1/health').subscribe({
      next: (response: ApiResponse<Record<string, unknown>>) => {
        this.loading = false;
        this.health = response.data || null;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Unable to load health status.';
      },
    });
  }
}
