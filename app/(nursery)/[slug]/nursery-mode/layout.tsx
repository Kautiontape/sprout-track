'use client';

import { useParams } from 'next/navigation';
import { DeploymentProvider } from '@/app/context/deployment';
import { LocalizationProvider } from '@/src/context/localization';
import { FamilyProvider } from '@/src/context/family';
import { BabyProvider } from '@/app/context/baby';

import { ThemeProvider } from '@/src/context/theme';
import { ToastProvider } from '@/src/components/ui/toast';

export default function NurseryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const slug = (params?.slug as string) || '';

  const handleLogout = async () => {
    const token = localStorage.getItem('authToken');

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
        },
      });
    } catch (error) {
      console.error('Error during logout:', error);
    }

    localStorage.removeItem('unlockTime');
    localStorage.removeItem('caretakerId');
    localStorage.removeItem('authToken');
    localStorage.removeItem('accountUser');
    localStorage.removeItem('attempts');
    localStorage.removeItem('lockoutTime');

    // Land on this family's PIN screen rather than the root home, so the
    // user sees the login flow directly after a 401-driven logout.
    if (slug) {
      const target = `/${slug}/nursery-mode`;
      window.location.href = `/${slug}?redirect=${encodeURIComponent(target)}`;
    } else {
      window.location.href = '/';
    }
  };

  return (
    <div style={{ background: '#0a0a1a', minHeight: '100vh' }}>
      <DeploymentProvider>
        <LocalizationProvider>
          <FamilyProvider onLogout={handleLogout}>
            <BabyProvider>
              <ThemeProvider>
                <ToastProvider>
                  {children}
                </ToastProvider>
              </ThemeProvider>
            </BabyProvider>
          </FamilyProvider>
        </LocalizationProvider>
      </DeploymentProvider>
    </div>
  );
}
