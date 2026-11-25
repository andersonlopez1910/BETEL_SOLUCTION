"use client";

import { AppShell } from "../../../../components/app-shell";
import { OrganizationProfile } from "../../../../components/organization-profile";

export default function OrganizationProfilePage() {
  return <AppShell title="Perfil de la organización" subtitle="Centro de identidad legal, tributaria y operativa de la empresa."><div className="page-content"><OrganizationProfile /></div></AppShell>;
}
