import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { ApiResponse } from '../core/types';

@Component({
  selector: 'app-dev-user-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dev-user-page.component.html',
})
export class DevUserPageComponent {
  private readonly api = inject(ApiService);

  form: Record<string, unknown> = {
    firstName: 'Ralph',
    lastName: 'Brabante',
    email: 'ralphjohnbrabante@gmail.com',
    password: 'Default123!',
    status: 'active',
    isEmailVerified: true,
    isActive: true,
  };

  submitting = false;
  message = '';
  error = '';

  submit(): void {
    this.submitting = true;
    this.message = '';
    this.error = '';

    this.api
      .create<Record<string, unknown>>('/api/v1/dev/users', this.form)
      .subscribe({
        next: (response: ApiResponse<Record<string, unknown>>) => {
          this.submitting = false;
          this.message = response.message || 'Development user created.';
        },
        error: (err) => {
          this.submitting = false;
          this.error = err?.error?.message || 'Unable to create development user.';
        },
      });
  }
}
