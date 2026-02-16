import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ConfirmDialogService } from '../core/confirm-dialog.service';
import { OrganizationContextService } from '../core/organization-context.service';
import { ThemeService } from '../core/theme.service';

interface NavItem {
  label: string;
  path: string;
  icon: string;
  permissions?: string[];
  superuserOnly?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
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
  readonly confirmDialog = inject(ConfirmDialogService);
  readonly organizationContext = inject(OrganizationContextService);
  readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  readonly navSections: NavSection[] = [
    {
      title: 'Overview',
      items: [
        { label: 'Dashboard', path: '/dashboard', icon: 'bi-speedometer2', permissions: ['dashboard.read'] },
        { label: 'Reports', path: '/reports', icon: 'bi-bar-chart-line', permissions: ['reports.*'] },
      ],
    },
    {
      title: 'Sales',
      items: [
        { label: 'Items', path: '/items', icon: 'bi-box-seam', permissions: ['items.read'] },
        { label: 'Customers', path: '/customers', icon: 'bi-person-vcard', permissions: ['organizations.read'] },
        { label: 'Orders', path: '/orders', icon: 'bi-receipt', permissions: ['orders.read'] },
        { label: 'Sales Invoices', path: '/sales-invoices', icon: 'bi-file-earmark-text', permissions: ['sales_invoices.read'] },
      ],
    },
    {
      title: 'Operations',
      items: [
        { label: 'Expenses', path: '/expenses', icon: 'bi-cash-stack', permissions: ['expenses.read'] },
        { label: 'Vendors', path: '/vendors', icon: 'bi-truck', permissions: ['vendors.read'] },
        { label: 'Taxes', path: '/taxes', icon: 'bi-percent', permissions: ['expenses.read'] },
      ],
    },
    {
      title: 'Administration',
      items: [
        { label: 'Organizations', path: '/organizations', icon: 'bi-buildings', permissions: ['organizations.read'] },
        { label: 'Users', path: '/users', icon: 'bi-people', permissions: ['users.read'] },
        { label: 'Roles', path: '/roles', icon: 'bi-shield-check', permissions: ['roles.manage'] },
        { label: 'Permissions', path: '/permissions', icon: 'bi-key', permissions: ['permissions.manage'] },
        { label: 'Licenses', path: '/licenses', icon: 'bi-patch-check', permissions: ['licenses.read'] },
        { label: 'Settings', path: '/settings', icon: 'bi-sliders', permissions: ['settings.update'], superuserOnly: true },
      ],
    },
  ];
  sidebarOpen = false;
  sidebarCollapsed = false;
  organizationOptions: Array<{ id: string; name?: string; legalName?: string }> = [];
  switchingOrganization = false;
  organizationDisplayName = 'Organization';
  canInstallApp = false;
  installingApp = false;
  private deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

  get userLabel(): string {
    const user = this.auth.currentUser();
    if (!user) {
      return 'Unknown User';
    }

    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return fullName || user.email || 'User';
  }

  get userInitials(): string {
    const user = this.auth.currentUser();
    const first = String(user?.firstName || '').trim().charAt(0);
    const last = String(user?.lastName || '').trim().charAt(0);
    const email = String(user?.email || '').trim().charAt(0);
    return `${first}${last}`.trim().toUpperCase() || email.toUpperCase() || 'U';
  }

  get userProfileImageUrl(): string {
    return String(this.auth.currentUser()?.profileImageUrl || '').trim();
  }

  logout(): void {
    this.organizationContext.clearSelectedOrganizationId();
    this.auth.clearSession();
    void this.router.navigate(['/login']);
  }

  goToProfile(): void {
    void this.router.navigate(['/profile']);
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

  readonly visibleNavSections = computed<NavSection[]>(() => {
    const canSee = (item: NavItem): boolean => {
      if (item.superuserOnly && !this.organizationContext.isSuperuser()) {
        return false;
      }
      return this.auth.hasAnyPermission(item.permissions || []);
    };

    return this.navSections
      .map((section) => ({
        ...section,
        items: section.items.filter(canSee),
      }))
      .filter((section) => section.items.length > 0);
  });

  get canSwitchOrganization(): boolean {
    return this.organizationContext.isSuperuser();
  }

  get selectedOrganizationId(): string {
    if (!this.canSwitchOrganization) {
      return this.organizationContext.getActiveOrganizationId();
    }
    const selected = String(this.organizationContext.selectedOrganizationId() || '').trim();
    if (selected) {
      return selected;
    }
    return String(this.auth.currentUser()?.organizationId || '').trim();
  }

  ngOnInit(): void {
    window.addEventListener('beforeinstallprompt', this.handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', this.handleAppInstalled);
    this.resolveOrganizationDisplayName();

    if (!this.canSwitchOrganization) {
      return;
    }

    this.api.list<{ id: string; name?: string; legalName?: string }>('/api/v1/organizations?limit=500').subscribe({
      next: (response) => {
        this.organizationOptions = response.data || [];
        this.updateDisplayNameFromOptions();
      },
      error: () => {
        this.organizationOptions = [];
      },
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('beforeinstallprompt', this.handleBeforeInstallPrompt);
    window.removeEventListener('appinstalled', this.handleAppInstalled);
  }

  closeUnauthorizedModal(): void {
    this.auth.clearUnauthorizedAccess();
  }

  closeConfirmModal(): void {
    this.confirmDialog.cancel();
  }

  approveConfirmModal(): void {
    this.confirmDialog.approve();
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  switchOrganization(organizationId: string): void {
    if (!this.canSwitchOrganization) {
      return;
    }
    if (this.switchingOrganization) {
      return;
    }
    const nextOrganizationId = String(organizationId || '').trim();
    const currentOrganizationId = String(this.selectedOrganizationId || '').trim();
    if (nextOrganizationId === currentOrganizationId) {
      return;
    }

    this.organizationContext.setSelectedOrganizationId(nextOrganizationId);
    this.updateDisplayNameFromOptions();
    this.switchingOrganization = true;
    setTimeout(() => {
      window.location.reload();
    }, 50);
  }

  async installApp(): Promise<void> {
    if (!this.deferredInstallPrompt || this.installingApp) {
      return;
    }

    this.installingApp = true;
    try {
      await this.deferredInstallPrompt.prompt();
      await this.deferredInstallPrompt.userChoice;
    } finally {
      this.deferredInstallPrompt = null;
      this.canInstallApp = false;
      this.installingApp = false;
    }
  }

  private resolveOrganizationDisplayName(): void {
    const organizationId = String(this.selectedOrganizationId || '').trim();
    if (!organizationId) {
      this.organizationDisplayName = 'Organization';
      return;
    }
    if (organizationId === this.organizationContext.ALL_ORGANIZATIONS) {
      this.organizationDisplayName = 'All Organizations';
      return;
    }

    // Non-superusers may not have organizations.read permission; avoid global 403 modal
    // from shell bootstrap calls by using user session fallback labels.
    if (!this.canSwitchOrganization) {
      const user = this.auth.currentUser();
      const fallbackName = String(user?.organizationName || user?.organizationLegalName || '').trim();
      if (fallbackName) {
        this.organizationDisplayName = fallbackName;
        return;
      }

      this.organizationDisplayName = 'Organization';
      this.api.get<{ user?: { organizationName?: string; organizationLegalName?: string; currency?: string } }>(
        '/api/v1/auth/session'
      ).subscribe({
        next: (response) => {
          const sessionUser = response.data?.user;
          const resolvedName = String(
            sessionUser?.organizationName || sessionUser?.organizationLegalName || 'Organization'
          ).trim();
          this.organizationDisplayName = resolvedName || 'Organization';
          if (sessionUser) {
            this.auth.updateCurrentUser({
              organizationName: sessionUser.organizationName,
              organizationLegalName: sessionUser.organizationLegalName,
              currency: sessionUser.currency,
            });
          }
        },
        error: () => {
          this.organizationDisplayName = 'Organization';
        },
      });
      return;
    }

    this.api.get<{ id: string; name?: string; legalName?: string }>(`/api/v1/organizations/${organizationId}`).subscribe({
      next: (response) => {
        const org = response.data;
        this.organizationDisplayName =
          String(org?.name || org?.legalName || organizationId).trim() || 'Organization';
      },
      error: () => {
        this.organizationDisplayName = organizationId;
      },
    });
  }

  private updateDisplayNameFromOptions(): void {
    const organizationId = String(this.selectedOrganizationId || '').trim();
    if (!organizationId) {
      this.organizationDisplayName = 'Organization';
      return;
    }
    if (organizationId === this.organizationContext.ALL_ORGANIZATIONS) {
      this.organizationDisplayName = 'All Organizations';
      return;
    }
    const match = this.organizationOptions.find((org) => org.id === organizationId);
    if (!match) {
      return;
    }
    this.organizationDisplayName =
      String(match.name || match.legalName || organizationId).trim() || 'Organization';
  }

  private readonly handleBeforeInstallPrompt = (event: Event): void => {
    event.preventDefault();
    this.deferredInstallPrompt = event as BeforeInstallPromptEvent;
    this.canInstallApp = true;
  };

  private readonly handleAppInstalled = (): void => {
    this.deferredInstallPrompt = null;
    this.canInstallApp = false;
  };

  trackByNavSection(_index: number, section: NavSection): string {
    return section.title;
  }

  trackByNavItem(_index: number, item: NavItem): string {
    return item.path;
  }

  trackByOrganization(_index: number, org: { id: string }): string {
    return org.id;
  }
}
