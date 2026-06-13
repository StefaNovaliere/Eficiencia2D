"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  clearStoredAuth,
  fetchCurrentUser,
  loadStoredAuth,
  loginUser,
  registerUser,
  saveStoredAuth,
  type AuthUser,
} from "@/services/auth";

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoadingAuth: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, nombre?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  const applyAuth = useCallback((accessToken: string, authUser: AuthUser) => {
    setToken(accessToken);
    setUser(authUser);
    saveStoredAuth({ token: accessToken, user: authUser });
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    clearStoredAuth();
  }, []);

  useEffect(() => {
    const stored = loadStoredAuth();
    if (!stored?.token) {
      setIsLoadingAuth(false);
      return;
    }

    fetchCurrentUser(stored.token)
      .then((currentUser) => {
        applyAuth(stored.token, currentUser);
      })
      .catch(() => {
        clearStoredAuth();
      })
      .finally(() => {
        setIsLoadingAuth(false);
      });
  }, [applyAuth]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await loginUser(email, password);
      applyAuth(data.access_token, data.user);
    },
    [applyAuth],
  );

  const register = useCallback(
    async (email: string, password: string, nombre?: string) => {
      const data = await registerUser(email, password, nombre);
      applyAuth(data.access_token, data.user);
    },
    [applyAuth],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoadingAuth,
        isAuthenticated: Boolean(user && token),
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth debe usarse dentro de AuthProvider");
  }
  return context;
}
