import { ChannelDevices } from "@/components/channel-devices";
import { PageBody } from "@/components/shell";
import { ModelSettingsForm } from "@/components/model-settings";

export default function SettingsPage() {
  return (
    <PageBody title="设置">
      <ModelSettingsForm />
      <ChannelDevices />
    </PageBody>
  );
}
