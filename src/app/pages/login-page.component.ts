import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ThemeService } from '../core/theme.service';
import { ApiResponse } from '../core/types';

interface LoginPayload {
  accessToken?: string;
  user?: {
    id?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    status?: string;
    organizationId?: string;
    currency?: string;
    roleCodes?: string[];
    permissionCodes?: string[];
  };
}

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login-page.component.html',
})
export class LoginPageComponent {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  email = '';
  password = '';
  loading = false;
  error = '';
  forgotEmail = '';
  forgotLoading = false;
  forgotMessage = '';
  forgotError = '';
  forgotModalVisible = false;
  verificationLoading = false;
  verificationMessage = '';

  get canResendVerification(): boolean {
    return String(this.error || '').toLowerCase().includes('not verified');
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  submit(): void {
    this.loading = true;
    this.error = '';
    this.verificationMessage = '';

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
            this.error = this.toErrorMessage(response?.message, 'Login failed.');
            return;
          }

          this.auth.setSession(token, response.data?.user);
          void this.router.navigate(['/dashboard']);
        },
        error: (errorResponse) => {
          this.loading = false;
          this.error = this.toErrorMessage(errorResponse?.error?.message, 'Unable to log in.');
        },
      });
  }

  openForgotModal(): void {
    this.forgotModalVisible = true;
    this.forgotEmail = this.email || '';
    this.forgotLoading = false;
    this.forgotMessage = '';
    this.forgotError = '';
  }

  closeForgotModal(): void {
    this.forgotModalVisible = false;
  }

  submitForgotPassword(): void {
    const normalizedEmail = String(this.forgotEmail || '').trim().toLowerCase();
    if (!normalizedEmail) {
      this.forgotError = 'Email is required.';
      this.forgotMessage = '';
      return;
    }

    this.forgotLoading = true;
    this.forgotError = '';
    this.forgotMessage = '';

    this.http
      .post<ApiResponse<unknown>>('/api/v1/auth/forgot-password', {
        email: normalizedEmail,
      })
      .subscribe({
        next: (response) => {
          this.forgotLoading = false;
          this.forgotMessage =
            response.message ||
            'If an account exists for that email, a password reset link has been sent.';
        },
        error: (errorResponse) => {
          this.forgotLoading = false;
          this.forgotError = this.toErrorMessage(
            errorResponse?.error?.message,
            'Unable to process password reset request.'
          );
        },
      });
  }

  resendVerificationEmail(): void {
    const normalizedEmail = String(this.email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      this.error = 'Enter your email first to request a verification link.';
      return;
    }

    this.verificationLoading = true;
    this.verificationMessage = '';

    this.http
      .post<ApiResponse<unknown>>('/api/v1/auth/request-email-verification', {
        email: normalizedEmail,
      })
      .subscribe({
        next: (response) => {
          this.verificationLoading = false;
          this.verificationMessage =
            response.message ||
            'If an account exists for that email, a verification link has been sent.';
        },
        error: (errorResponse) => {
          this.verificationLoading = false;
          this.verificationMessage = this.toErrorMessage(
            errorResponse?.error?.message,
            'Unable to send verification email.'
          );
        },
      });
  }

  private toErrorMessage(value: unknown, fallback: string): string {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    if (value && typeof value === 'object') {
      const fromMessage = (value as { message?: unknown }).message;
      if (typeof fromMessage === 'string' && fromMessage.trim()) {
        return fromMessage;
      }
      try {
        return JSON.stringify(value);
      } catch (_err) {
        return fallback;
      }
    }
    return fallback;
  }
}
