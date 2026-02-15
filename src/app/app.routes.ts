import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { permissionGuard } from './core/permission.guard';
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
import { RoleDetailPageComponent } from './pages/role-detail-page.component';
import { SalesInvoicesPageComponent } from './pages/sales-invoices-page.component';
import { SalesInvoiceDetailPageComponent } from './pages/sales-invoice-detail-page.component';
import { UsersPageComponent } from './pages/users-page.component';
import { VendorsPageComponent } from './pages/vendors-page.component';
import { UserDetailPageComponent } from './pages/user-detail-page.component';

export const routes: Routes = [
  { path: 'login', component: LoginPageComponent },
  {
    path: '',
    component: AppShellComponent,
    canActivate: [authGuard],
    children: [
      { path: 'dashboard', component: DashboardPageComponent },
      { path: 'organizations', component: OrganizationsPageComponent, canActivate: [permissionGuard], data: { permissions: ['organizations.read'] } },
      { path: 'organizations/:id', component: OrganizationDetailPageComponent, canActivate: [permissionGuard], data: { permissions: ['organizations.read'] } },
      { path: 'users', component: UsersPageComponent, canActivate: [permissionGuard], data: { permissions: ['users.read'] } },
      { path: 'users/:id', component: UserDetailPageComponent, canActivate: [permissionGuard], data: { permissions: ['users.read'] } },
      { path: 'roles', component: RolesPageComponent, canActivate: [permissionGuard], data: { permissions: ['roles.manage'] } },
      { path: 'roles/:id', component: RoleDetailPageComponent, canActivate: [permissionGuard], data: { permissions: ['roles.manage'] } },
      { path: 'permissions', component: PermissionsPageComponent, canActivate: [permissionGuard], data: { permissions: ['permissions.manage'] } },
      { path: 'reports', component: ReportsPageComponent, canActivate: [permissionGuard], data: { permissions: ['reports.read'] } },
      { path: 'items', component: ItemsPageComponent, canActivate: [permissionGuard], data: { permissions: ['items.read'] } },
      { path: 'orders', component: OrdersPageComponent, canActivate: [permissionGuard], data: { permissions: ['orders.read'] } },
      { path: 'orders/create', component: CreateOrderPageComponent, canActivate: [permissionGuard], data: { permissions: ['orders.create'] } },
      { path: 'orders/:id', component: OrderPreviewPageComponent, canActivate: [permissionGuard], data: { permissions: ['orders.read'] } },
      { path: 'customers', component: CustomersPageComponent, canActivate: [permissionGuard], data: { permissions: ['organizations.read'] } },
      { path: 'expenses', component: ExpensesPageComponent, canActivate: [permissionGuard], data: { permissions: ['expenses.read'] } },
      { path: 'vendors', component: VendorsPageComponent, canActivate: [permissionGuard], data: { permissions: ['vendors.read'] } },
      { path: 'licenses', component: LicensesPageComponent, canActivate: [permissionGuard], data: { permissions: ['licenses.read'] } },
      { path: 'license/:id', component: LicenseEditPageComponent, canActivate: [permissionGuard], data: { permissions: ['licenses.read'] } },
      { path: 'sales-invoices', component: SalesInvoicesPageComponent, canActivate: [permissionGuard], data: { permissions: ['sales_invoices.read'] } },
      { path: 'sales-invoices/:id', component: SalesInvoiceDetailPageComponent, canActivate: [permissionGuard], data: { permissions: ['sales_invoices.read'] } },
      { path: 'dev-user', component: DevUserPageComponent, canActivate: [permissionGuard], data: { permissions: ['users.create'] } },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  { path: '**', redirectTo: '' },
];
