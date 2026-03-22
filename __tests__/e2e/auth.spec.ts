import { test, expect } from '@playwright/test';
import { mockAuth } from './helpers/mocks';

test.describe('Login Page', () => {
  test('loads with email and password fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h1', { hasText: 'Welcome back' })).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button', { hasText: 'Sign In' })).toBeVisible();
  });

  test('has link to signup page', async ({ page }) => {
    await page.goto('/login');
    const signupLink = page.locator('a', { hasText: 'Sign up' });
    await expect(signupLink).toBeVisible();
    await expect(signupLink).toHaveAttribute('href', '/signup');
  });

  test('login with valid credentials redirects to dashboard', async ({ page }) => {
    await mockAuth(page);
    await page.goto('/login');

    await page.locator('input[type="email"]').fill('test@example.com');
    await page.locator('input[type="password"]').fill('password123');
    await page.locator('button', { hasText: 'Sign In' }).click();

    // Should redirect to dashboard
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    expect(page.url()).toContain('/dashboard');
  });

  test('login with invalid credentials shows error', async ({ page }) => {
    await mockAuth(page);
    await page.goto('/login');

    await page.locator('input[type="email"]').fill('wrong@example.com');
    await page.locator('input[type="password"]').fill('wrongpassword');
    await page.locator('button', { hasText: 'Sign In' }).click();

    // Should show error message
    const errorBox = page.locator('text=Invalid login credentials');
    await expect(errorBox).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Signup Page', () => {
  test('loads with name, email, and password fields', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('h1', { hasText: 'Create account' })).toBeVisible();
    await expect(page.locator('input[type="text"]')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button', { hasText: 'Create Account' })).toBeVisible();
  });

  test('has link to login page', async ({ page }) => {
    await page.goto('/signup');
    const loginLink = page.locator('a', { hasText: 'Sign in' });
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toHaveAttribute('href', '/login');
  });

  test('signup success shows confirmation message', async ({ page }) => {
    await mockAuth(page);
    await page.goto('/signup');

    await page.locator('input[type="text"]').fill('Test User');
    await page.locator('input[type="email"]').fill('newuser@example.com');
    await page.locator('input[type="password"]').fill('password123');
    await page.locator('button', { hasText: 'Create Account' }).click();

    // Should show "Check your email" confirmation
    await expect(page.locator('h1', { hasText: 'Check your email' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('newuser@example.com')).toBeVisible();
  });
});
