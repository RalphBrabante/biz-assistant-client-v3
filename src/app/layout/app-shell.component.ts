import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';

interface NavItem {
  label: string;
  path: string;
  icon: string;
}

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app-shell.component.html',
})
export class AppShellComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly navItems: NavItem[] = [
    { label: 'Dashboard', path: '/dashboard', icon: 'bi-speedometer2' },
    { label: 'Organizations', path: '/organizations', icon: 'bi-buildings' },
    { label: 'Users', path: '/users', icon: 'bi-people' },
    { label: 'Roles', path: '/roles', icon: 'bi-shield-check' },
    { label: 'Permissions', path: '/permissions', icon: 'bi-key' },
    { label: 'Items', path: '/items', icon: 'bi-box-seam' },
    { label: 'Customers', path: '/customers', icon: 'bi-person-vcard' },
    { label: 'Orders', path: '/orders', icon: 'bi-receipt' },
    { label: 'Licenses', path: '/licenses', icon: 'bi-patch-check' },
    { label: 'Sales Invoices', path: '/sales-invoices', icon: 'bi-file-earmark-text' },
    { label: 'Dev User', path: '/dev-user', icon: 'bi-person-plus' },
  ];
  sidebarOpen = false;
  sidebarCollapsed = false;

  get userLabel(): string {
    const user = this.auth.currentUser();
    if (!user) {
      return 'Unknown User';
    }

    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return fullName || user.email || 'User';
  }

  logout(): void {
    this.auth.clearSession();
    void this.router.navigate(['/login']);
  }

  openSidebar(): void {
    this.sidebarOpen = true;
  }

  closeSidebar(): void {
    this.sidebarOpen = false;
  }

  closeSidebarAfterNav(): void {
    this.sidebarOpen = false;
  }

  toggleSidebarCollapsed(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }
}
