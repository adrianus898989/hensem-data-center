"use client";
import { useEffect, useState, type ReactNode } from "react";
import { isAdminLightPilot, type PilotProfile } from "./account";
import type { PilotPresentation } from "./presentation";

type Props = {
  profile: PilotProfile;
  sessionId: string;
  children: (presentation: PilotPresentation) => ReactNode;
};

export default function LightPilotGate({ profile, sessionId, children }: Props) {
  const { active, username, auth_user_id } = profile;
  const [ready, setReady] = useState<{ id: string; presentation: PilotPresentation } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    const returnToStandard = () => window.location.replace("/hensem-data-center/" + window.location.hash);
    const verify = async () => {
      try {
        const matched = await isAdminLightPilot({ active, username, auth_user_id }, sessionId);
        if (!current) return;
        if (!matched) { returnToStandard(); return; }
        const { presentation } = await import("./presentation");
        if (current) setReady({id: sessionId, presentation});
      } catch {
        if (current) setFailed(true);
      }
    };
    void verify();
    return () => { current = false; };
  }, [active, username, auth_user_id, sessionId]);

  if (ready?.id === sessionId && active && username === "admin" && auth_user_id === sessionId) return children(ready.presentation);
  if (failed) return <p role="alert">试点界面加载失败。<a href="/hensem-data-center/">返回正式版</a></p>;
  return <p role="status">正在确认试点权限…</p>;
}
