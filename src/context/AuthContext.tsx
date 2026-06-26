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
  isActiveUser,
  loadStoredAuth,
  loginUser,
  registerUser,
  verifyEmailToken,
  saveStoredAuth,
  type AuthUser,
  type RegisterResponse,
} from "@/services/auth";

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoadingAuth: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Crea la cuenta. Devuelve la respuesta de registro (sin JWT). */
  register: (email: string, password: string, nombre?: string) => Promise<RegisterResponse>;
  /** Verifica el email con el token del link y aplica la sesión. */
  verifyEmail: (token: string) => Promise<void>;
  logout: () => void;
  /** Sincroniza datos básicos del usuario en sesión (p. ej. tras PATCH /users/me). */
  updateUser: (partial: Partial<AuthUser>) => void;
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

  const updateUser = useCallback(
    (partial: Partial<AuthUser>) => {
      setUser((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...partial };
        setToken((currentToken) => {
          if (currentToken) {
            saveStoredAuth({ token: currentToken, user: next });
          }
          return currentToken;
        });
        return next;
      });
    },
    [],
  );

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
    async (email: string, password: string, nombre?: string): Promise<RegisterResponse> => {
      // Ya no devuelve JWT — solo registra y pide verificar correo.
      return registerUser(email, password, nombre);
    },
    [],
  );

  const verifyEmail = useCallback(
    async (verifyToken: string) => {
      const data = await verifyEmailToken(verifyToken);
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
        isAuthenticated: Boolean(user && token && isActiveUser(user)),
        login,
        register,
        verifyEmail,
        logout,
        updateUser,
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
