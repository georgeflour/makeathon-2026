"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Widget } from "@/lib/api";

export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  onboarding_completed: boolean;
  settings: {
    color_palette?: string;
    theme?: string;
    saved_widgets?: Widget[];
  };
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  completeOnboarding: (displayName: string, colorPalette: string, theme: string) => Promise<void>;
  updateSettings: (settings: UserProfile["settings"]) => Promise<void>;
  saveProfile: (updates: { display_name?: string | null; settings?: UserProfile["settings"] }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string, email: string) => {
    const { data: existing } = await supabase
      .from("app_users")
      .select("*")
      .eq("id", userId)
      .single();

    if (existing) {
      setProfile(existing as UserProfile);
      return;
    }

    // New user — create profile row
    const newProfile = {
      id: userId,
      email,
      display_name: null,
      onboarding_completed: false,
      settings: {},
    };
    const { data: created, error } = await supabase
      .from("app_users")
      .insert(newProfile)
      .select()
      .single();

    if (created) {
      setProfile(created as UserProfile);
    } else {
      // Insert failed (e.g. RLS or race) — surface locally so onboarding still works
      console.error("Failed to create user profile:", error?.message);
      setProfile(newProfile as UserProfile);
    }
  }, []);

  // Tracks whether the initial session check has already completed.
  // Prevents onAuthStateChange from double-calling loadProfile on mount
  // (Supabase fires INITIAL_SESSION synchronously, which races with getSession).
  const initialisedRef = useRef(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (event === "INITIAL_SESSION") {
        // getSession() below will handle the initial load & setIsLoading(false)
        return;
      }

      if (session?.user) {
        loadProfile(session.user.id, session.user.email ?? "").finally(() => {
          setIsLoading(false);
        });
      } else {
        setProfile(null);
        setIsLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!initialisedRef.current) {
        initialisedRef.current = true;
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          loadProfile(session.user.id, session.user.email ?? "").finally(() =>
            setIsLoading(false)
          );
        } else {
          setIsLoading(false);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error?.message ?? null;
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<string | null> => {
    const { error } = await supabase.auth.signUp({ email, password });
    return error?.message ?? null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const completeOnboarding = useCallback(
    async (displayName: string, colorPalette: string, theme: string) => {
      if (!user) return;
      const updates = {
        display_name: displayName.trim() || null,
        onboarding_completed: true,
        settings: { color_palette: colorPalette, theme },
      };
      const { data } = await supabase
        .from("app_users")
        .update(updates)
        .eq("id", user.id)
        .select()
        .single();
      if (data) setProfile(data as UserProfile);
    },
    [user]
  );

  const updateSettings = useCallback(
    async (settings: UserProfile["settings"]) => {
      if (!user || !profile) return;
      const merged = { ...profile.settings, ...settings };
      const { data } = await supabase
        .from("app_users")
        .update({ settings: merged })
        .eq("id", user.id)
        .select()
        .single();
      if (data) setProfile(data as UserProfile);
    },
    [user, profile]
  );

  const saveProfile = useCallback(
    async (updates: { display_name?: string | null; settings?: UserProfile["settings"] }) => {
      if (!user || !profile) return;
      const payload: Record<string, unknown> = {};
      if ("display_name" in updates) payload.display_name = updates.display_name;
      if (updates.settings) payload.settings = { ...profile.settings, ...updates.settings };
      const { data } = await supabase
        .from("app_users")
        .update(payload)
        .eq("id", user.id)
        .select()
        .single();
      if (data) setProfile(data as UserProfile);
    },
    [user, profile]
  );

  return (
    <AuthContext.Provider
      value={{
        session, user, profile, isLoading,
        signIn, signUp, signOut,
        completeOnboarding, updateSettings, saveProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
