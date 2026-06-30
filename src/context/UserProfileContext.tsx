"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/context/AuthContext";
import {
  fetchUserProfile,
  updateUserProfile,
  type UserProfile,
} from "@/services/users";

interface UserProfileContextType {
  profile: UserProfile | null;
  isLoadingProfile: boolean;
  profileError: string | null;
  refreshProfile: () => Promise<void>;
  updateNombre: (nombre: string) => Promise<UserProfile>;
  clearProfileError: () => void;
}

const UserProfileContext = createContext<UserProfileContextType | undefined>(undefined);

export function UserProfileProvider({ children }: { children: ReactNode }) {
  const { token, isLoadingAuth, updateUser } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!token) {
      setProfile(null);
      setProfileError(null);
      return;
    }

    setIsLoadingProfile(true);
    setProfileError(null);

    try {
      const data = await fetchUserProfile(token);
      setProfile(data);
      updateUser({
        nombre: data.nombre,
        email: data.email,
        estado: data.estado,
        rol_id: data.rol_id,
        rol: data.rol,
      });
    } catch (err) {
      setProfile(null);
      setProfileError(err instanceof Error ? err.message : "No se pudo cargar el perfil");
    } finally {
      setIsLoadingProfile(false);
    }
  }, [token, updateUser]);

  useEffect(() => {
    if (isLoadingAuth) return;
    void loadProfile();
  }, [isLoadingAuth, loadProfile]);

  const updateNombre = useCallback(
    async (nombre: string) => {
      if (!token) {
        throw new Error("Tenés que iniciar sesión");
      }

      setProfileError(null);
      const updated = await updateUserProfile(token, { nombre });
      setProfile(updated);
      updateUser({ nombre: updated.nombre });
      return updated;
    },
    [token, updateUser],
  );

  const clearProfileError = useCallback(() => {
    setProfileError(null);
  }, []);

  return (
    <UserProfileContext.Provider
      value={{
        profile,
        isLoadingProfile,
        profileError,
        refreshProfile: loadProfile,
        updateNombre,
        clearProfileError,
      }}
    >
      {children}
    </UserProfileContext.Provider>
  );
}

export function useUserProfile() {
  const context = useContext(UserProfileContext);
  if (!context) {
    throw new Error("useUserProfile debe usarse dentro de UserProfileProvider");
  }
  return context;
}
