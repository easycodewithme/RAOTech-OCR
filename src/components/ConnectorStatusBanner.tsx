"use client";

import Link from "next/link";
import { PlugZap } from "lucide-react";
import { relativeTime, useConnectorStatus } from "@/components/tallyClient";

/**
 * A queued push does not move while the desktop agent is down, and nothing in
 * the app can make it move. That is worth saying once, everywhere, rather than
 * per screen — so this sits under the dashboard header on every page.
 *
 * It stays quiet for anyone who has never paired a device: a workspace that
 * exports XML by hand is not "offline", it simply is not using the connector.
 */
export function ConnectorStatusBanner() {
  const { data } = useConnectorStatus({ intervalMs: 20_000 });

  if (!data?.device || data.connectorOnline) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 md:px-6">
      <PlugZap className="h-4 w-4 shrink-0" />
      <span className="font-semibold">Connector offline</span>
      <span className="text-amber-800">
        {data.device.deviceName} was last seen {relativeTime(data.device.lastSeenAt)}. Anything you
        push stays queued until it is running again.
      </span>
      <Link
        href="/settings/tally"
        className="font-medium underline underline-offset-2 hover:text-amber-950"
      >
        Tally Connection
      </Link>
    </div>
  );
}
