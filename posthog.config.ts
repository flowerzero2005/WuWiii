/**
 * Analytics is disabled in the private desktop export. This repository contains
 * no project key or analytics endpoint configuration, and the renderer skips
 * SDK initialization when the key is absent.
 */
export const POSTHOG_PROJECT_KEY_DESKTOP = ''

export const DEFAULT_POSTHOG_CONFIG = {
  autocapture: false,
  capture_pageleave: false,
  capture_pageview: false,
  disable_session_recording: true,
  opt_out_capturing_by_default: true,
  opt_out_persistence_by_default: true,
} as const
