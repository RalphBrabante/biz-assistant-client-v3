import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { AppShellComponent } from './layout/app-shell.component';
import { DashboardPageComponent } from './pages/dashboard-page.component';
import { CreateOrderPageComponent } from './pages/create-order-page.component';
import { CustomersPageComponent } from './pages/customers-page.component';
import { ExpensesPageComponent } from './pages/expenses-page.component';
import { DevUserPageComponent } from './pages/dev-user-page.component';
import { ItemsPageComponent } from './pages/items-page.component';
import { LicensesPageComponent } from './pages/licenses-page.component';
import { LicenseEditPageComponent } from './pages/license-edit-page.component';
import { LoginPageComponent } from './pages/login-page.component';
import { OrganizationDetailPageComponent } from './pages/organization-detail-page.component';
import { OrganizationsPageComponent } from './pages/organizations-page.component';
import { OrdersPageComponent } from './pages/orders-page.component';
import { OrderPreviewPageComponent } from './pages/order-preview-page.component';
import { PermissionsPageComponent } from './pages/permissions-page.component';
import { ReportsPageComponent } from './pages/reports-page.component';
import { ResourcePageComponent } from './pages/resource-page.component';
import { RolesPageComponent } from './pages/roles-page.component';
import { SalesInvoicesPageComponent } from './pages/sales-invoices-page.component';
import { SalesInvoiceDetailPageComponent } from './pages/sales-invoice-detail-page.component';
import { UsersPageComponent } from './pages/users-page.component';
import { VendorsPageComponent } from './pages/vendors-page.component';

export const routes: Routes = [
  { path: 'login', component: LoginPageComponent },
  {
    path: '',
    component: AppShellComponent,
    canActivate: [authGuard],
    children: [
      { path: 'dashboard', component: DashboardPageComponent },
      { path: 'organizations', component: OrganizationsPageComponent },
      { path: 'organizations/:id', component: OrganizationDetailPageComponent },
      { path: 'users', component: UsersPageComponent },
      { path: 'roles', component: RolesPageComponent },
      { path: 'permissions', component: PermissionsPageComponent },
      { path: 'reports', component: ReportsPageComponent },
      { path: 'items', component: ItemsPageComponent },
      { path: 'orders', component: OrdersPageComponent },
      { path: 'orders/create', component: CreateOrderPageComponent },
      { path: 'orders/:id', component: OrderPreviewPageComponent },
      { path: 'customers', component: CustomersPageComponent },
      { path: 'expenses', component: ExpensesPageComponent },
      { path: 'vendors', component: VendorsPageComponent },
      { path: 'licenses', component: LicensesPageComponent },
      { path: 'license/:id', component: LicenseEditPageComponent },
      { path: 'sales-invoices', component: SalesInvoicesPageComponent },
      { path: 'sales-invoices/:id', component: SalesInvoiceDetailPageComponent },
      { path: 'dev-user', component: DevUserPageComponent },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  { path: '**', redirectTo: '' },
];
