import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Box, Button, Card, EnvelopeList, ProjectCard, Text, TextField } from "@finance/ui";
import { Screen, SectionTitle } from "../ui/primitives";
import { core } from "../rust/core";
import { parseEuro } from "../lib/money";
import { envelopes, addEnvelope, fundEnvelope } from "../db/appFeatures";
import { projects, projectPurchases, addProject, addProjectPurchase, projectGroups, addProjectGroup } from "../db/upstreamFeatures";

export default function ProjectsScreen() {
  const router = useRouter();
  const [envs, setEnvs] = useState<{ id: number; name: string; balanceCents: number; limitCents: number; rollover: number }[]>([]);
  const [groups, setGroups] = useState<{ id: number; name: string }[]>([]);
  const [projs, setProjs] = useState<{ id: number; name: string; targetCents: number }[]>([]);
  const [purchases, setPurchases] = useState<{ id: number; projectId: number; name: string; cents: number }[]>([]);
  const [envName, setEnvName] = useState("");
  const [envLimit, setEnvLimit] = useState("250");
  const [groupName, setGroupName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [purchaseName, setPurchaseName] = useState("");
  const [purchaseAmount, setPurchaseAmount] = useState("");

  const load = async () => {
    const [e, g, p, pp] = await Promise.all([envelopes(), projectGroups(), projects(), projectPurchases()]);
    setEnvs(e as never); setGroups(g); setProjs(p); setPurchases(pp);
  };
  useEffect(() => { void load(); }, []);

  const project = projs[0];
  const items = purchases.filter((p) => p.projectId === project?.id).map((p) => ({ name: p.name, cents: p.cents }));
  const funding = core.projectFunding(items, 5000);

  return (
    <Screen title="Projects" subtitle="Jings projects + Dompetku envelopes" back={<Button label="Back" variant="secondary" onPress={() => router.back()} />}>
      <Card>
        <SectionTitle>Projects</SectionTitle>
        <TextField label="New group" value={groupName} onChangeText={setGroupName} />
        <Button label="Add group" variant="secondary" onPress={() => { if (groupName) void addProjectGroup(groupName).then(() => { setGroupName(""); void load(); }); }} />
        <TextField label="New project" value={projectName} onChangeText={setProjectName} />
        <Button label="Add project" variant="secondary" onPress={() => { if (projectName && groups[0]) void addProject(groups[0].id, projectName, 0).then(() => { setProjectName(""); void load(); }); }} />
        <TextField label="Purchase" value={purchaseName} onChangeText={setPurchaseName} />
        <TextField label="Cost" value={purchaseAmount} onChangeText={setPurchaseAmount} numeric />
        <Button label="Add purchase" icon="plus" onPress={() => { const c = parseEuro(purchaseAmount); if (c !== null && purchaseName && project) void addProjectPurchase(project.id, purchaseName, c, false).then(() => { setPurchaseName(""); setPurchaseAmount(""); void load(); }); }} />
        {project ? <ProjectCard name={project.name} targetCents={project.targetCents} items={funding.items} unusedCents={funding.unused} /> : null}
      </Card>
      <Card>
        <SectionTitle>Envelopes / Kantong</SectionTitle>
        <EnvelopeList envelopes={envs.map((e) => ({ id: String(e.id), name: e.name, balanceCents: e.balanceCents, limitCents: e.limitCents, rollover: !!e.rollover }))} />
        <TextField label="New envelope" value={envName} onChangeText={setEnvName} />
        <TextField label="Limit" value={envLimit} onChangeText={setEnvLimit} numeric />
        <Button label="Add envelope" icon="plus" onPress={() => { const c = parseEuro(envLimit); if (c !== null && envName) void addEnvelope(envName, c, true).then(() => { setEnvName(""); void load(); }); }} />
        <Box gap={8}>{envs.map((e) => <Button key={e.id} label={`+10 ${e.name}`} variant="secondary" onPress={() => void fundEnvelope(e.id, 1000).then(load)} />)}</Box>
      </Card>
    </Screen>
  );
}
