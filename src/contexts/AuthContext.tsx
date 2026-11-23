import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  auth,
  signInWithGooglePopup,
  signOutGoogle,
} from '@/src/lib/firebase';
import {
  ensureUserProfile,
  subscribeUserProfile,
} from '@/src/lib/firestoreStore';
import {
  fetchCreditStatus,
  type CreditStatusResponse,
} from '@/src/lib/api';
import type { UserProfileRecord } from '@/src/types/investigation';

interface AuthContextValue {
  user: User | null;
  profile: UserProfileRecord | null;
  authReady: boolean;
  signingIn: boolean;
  authError: string | null;
  creditStatus: CreditStatusResponse | null;
  creditsLoading: boolean;
  refreshCredits: (nextStatus?: CreditStatusResponse) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfileRecord | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [creditStatus, setCreditStatus] = useState<CreditStatusResponse | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(true);

  const refreshCredits = useCallback(
    async (nextStatus?: CreditStatusResponse, explicitUser?: User | null) => {
      if (nextStatus) {
        setCreditStatus(nextStatus);
        setCreditsLoading(false);
        return;
      }
      setCreditsLoading(true);
      try {
        const targetUser = explicitUser !== undefined ? explicitUser : auth.currentUser;
        const idToken = targetUser ? await targetUser.getIdToken().catch(() => undefined) : undefined;
        const status = await fetchCreditStatus(idToken);
        setCreditStatus(status);
      } catch {
        // Keep prior status if offline; server enforces strictly on POST anyway
      } finally {
        setCreditsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    let mounted = true;
    let activeSequence = 0;
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (nextUser) => {
      const seq = ++activeSequence;
      unsubProfile?.();
      unsubProfile = null;
      if (!mounted) return;

      setUser(nextUser);
      setAuthError(null);

      if (nextUser) {
        try {
          const initial = await ensureUserProfile(nextUser);
          if (!mounted || seq !== activeSequence) return;
          setProfile(initial);
          unsubProfile = subscribeUserProfile(nextUser.uid, (updated) => {
            if (!mounted || seq !== activeSequence) return;
            setProfile(updated);
          });
        } catch (err) {
          if (!mounted || seq !== activeSequence) return;
          setAuthError(
            err instanceof Error
              ? err.message
              : 'Unable to load workspace profile.'
          );
        }
      } else {
        setProfile(null);
      }

      if (!mounted || seq !== activeSequence) return;
      setAuthReady(true);
      void refreshCredits(undefined, nextUser);
    });

    return () => {
      mounted = false;
      activeSequence++;
      unsubAuth();
      unsubProfile?.();
    };
  }, [refreshCredits]);

  const signInWithGoogle = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      const cred = await signInWithGooglePopup();
      await refreshCredits(undefined, cred.user);
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'Google sign-in popup was closed or blocked.'
      );
    } finally {
      setSigningIn(false);
    }
  };

  const signOut = async () => {
    setAuthError(null);
    await signOutGoogle();
    setProfile(null);
    await refreshCredits();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        authReady,
        signingIn,
        authError,
        creditStatus,
        creditsLoading,
        refreshCredits,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
