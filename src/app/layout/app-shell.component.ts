import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { OrganizationContextService } from '../core/organization-context.service';
import { ThemeService } from '../core/theme.service';

interface NavItem {
  label: string;
  path: string;
  icon: string;
  permissions?: string[];
}

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app-shell.component.html',
})
export class AppShellComponent {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly organizationContext = inject(OrganizationContextService);
  readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  readonly navItems: NavItem[] = [
    { label: 'Dashboard', path: '/dashboard', icon: 'bi-speedometer2' },
    { label: 'Organizations', path: '/organizations', icon: 'bi-buildings', permissions: ['organizations.read'] },
    { label: 'Users', path: '/users', icon: 'bi-people', permissions: ['users.read'] },
    { label: 'Roles', path: '/roles', icon: 'bi-shield-check', permissions: ['roles.manage'] },
    { label: 'Permissions', path: '/permissions', icon: 'bi-key', permissions: ['permissions.manage'] },
    { label: 'Reports', path: '/reports', icon: 'bi-bar-chart-line', permissions: ['reports.read'] },
    { label: 'Items', path: '/items', icon: 'bi-box-seam', permissions: ['items.read'] },
    { label: 'Customers', path: '/customers', icon: 'bi-person-vcard', permissions: ['organizations.read'] },
    { label: 'Vendors', path: '/vendors', icon: 'bi-truck', permissions: ['vendors.read'] },
    { label: 'Expenses', path: '/expenses', icon: 'bi-cash-stack', permissions: ['expenses.read'] },
    { label: 'Orders', path: '/orders', icon: 'bi-receipt', permissions: ['orders.read'] },
    { label: 'Licenses', path: '/licenses', icon: 'bi-patch-check', permissions: ['licenses.read'] },
    { label: 'Sales Invoices', path: '/sales-invoices', icon: 'bi-file-earmark-text', permissions: ['sales_invoices.read'] },
    { label: 'Dev User', path: '/dev-user', icon: 'bi-person-plus', permissions: ['users.create'] },
  ];
  sidebarOpen = false;
  sidebarCollapsed = false;
  organizationOptions: Array<{ id: string; name?: string; legalName?: string }> = [];
  switchingOrganization = false;

  get userLabel(): string {
    const user = this.auth.currentUser();
    if (!user) {
      return 'Unknown User';
    }

    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return fullName || user.email || 'User';
  }

  logout(): void {
    this.organizationContext.clearSelectedOrganizationId();
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

  get visibleNavItems(): NavItem[] {
    return this.navItems.filter((item) =>
      this.auth.hasAnyPermission(item.permissions || [])
    );
  }

  get canSwitchOrganization(): boolean {
    return this.organizationContext.isSuperuser();
  }

  get selectedOrganizationId(): string {
    return this.organizationContext.getActiveOrganizationId();
  }

  ngOnInit(): void {
    if (!this.canSwitchOrganization) {
      return;
    }

    this.api.list<{ id: string; name?: string; legalName?: string }>('/api/v1/organizations?limit=500').subscribe({
      next: (response) => {
        this.organizationOptions = response.data || [];
      },
      error: () => {
        this.organizationOptions = [];
      },
    });
  }

  closeUnauthorizedModal(): void {
    this.auth.clearUnauthorizedAccess();
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  switchOrganization(organizationId: string): void {
    if (!this.canSwitchOrganization) {
      return;
    }
    this.organizationContext.setSelectedOrganizationId(organizationId);
    this.switchingOrganization = true;
    setTimeout(() => {
      window.location.reload();
    }, 50);
  }
}
