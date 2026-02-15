import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ApiResponse } from '../core/types';

interface LoginPayload {
  accessToken?: string;
  user?: {
    id?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    status?: string;
  };
}

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login-page.component.html',
})
export class LoginPageComponent {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  email = 'ralphjohnbrabante@gmail.com';
  password = 'Default123!';
  loading = false;
  error = '';

  submit(): void {
    this.loading = true;
    this.error = '';

    this.http
      .post<ApiResponse<LoginPayload>>('/api/v1/auth/login', {
        email: this.email,
        password: this.password,
      })
      .subscribe({
        next: (response) => {
          this.loading = false;
          const token = response.data?.accessToken;

          if (!token) {
            this.error = response.message || 'Login failed.';
            return;
          }

          this.auth.setSession(token, response.data?.user);
          void this.router.navigate(['/dashboard']);
        },
        error: (errorResponse) => {
          this.loading = false;
          this.error = errorResponse?.error?.message || 'Unable to log in.';
        },
      });
  }
}
