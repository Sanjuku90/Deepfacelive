import React, { useEffect, useRef, useState } from "react";
import { Layout } from "@/components/layout";
import { useGetConfig, useUpdateConfig } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

export default function Settings() {
  const { data: config } = useGetConfig();
  const updateConfig = useUpdateConfig();

  const [localConfig, setLocalConfig] = useState(config);
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (config && !localConfig) {
      setLocalConfig(config);
    }
  }, [config]);

  const handleChange = (key: string, value: any) => {
    if (!localConfig) return;
    
    const newConfig = { ...localConfig, [key]: value };
    setLocalConfig(newConfig);

    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    
    saveTimeout.current = setTimeout(() => {
      updateConfig.mutate({ data: { [key]: value } });
    }, 500);
  };

  if (!localConfig) return null;

  return (
    <Layout>
      <div className="p-8 max-w-4xl mx-auto w-full flex flex-col h-full overflow-y-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold font-mono tracking-tight text-white mb-2">Studio Configuration</h1>
          <p className="text-muted-foreground">Adjust rendering parameters and AI modules. Changes auto-save.</p>
        </div>

        <div className="grid gap-8">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-primary font-mono uppercase text-sm tracking-widest">Rendering Pipeline</CardTitle>
              <CardDescription>Control the visual fidelity of the 3D avatar output.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label>Render Quality</Label>
                <Select 
                  value={localConfig.renderQuality} 
                  onValueChange={(val) => handleChange('renderQuality', val)}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select quality" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low (Fastest)</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="ultra">Ultra (Cinematic)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Label>Smoothing Factor</Label>
                  <span className="text-xs font-mono text-muted-foreground">{localConfig.smoothingFactor}</span>
                </div>
                <Slider 
                  value={[localConfig.smoothingFactor]} 
                  min={0} max={1} step={0.1}
                  onValueChange={([val]) => handleChange('smoothingFactor', val)}
                />
                <p className="text-xs text-muted-foreground">Higher values reduce jitter but add latency to movements.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-primary font-mono uppercase text-sm tracking-widest">Audio & AI Modules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Lip Sync</Label>
                  <p className="text-xs text-muted-foreground">Drive avatar mouth movements from microphone input.</p>
                </div>
                <Switch 
                  checked={localConfig.enableLipSync} 
                  onCheckedChange={(val) => handleChange('enableLipSync', val)} 
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Voice Modulation</Label>
                  <p className="text-xs text-muted-foreground">Alter your voice to match the active avatar.</p>
                </div>
                <Switch 
                  checked={localConfig.enableVoiceModulation} 
                  onCheckedChange={(val) => handleChange('enableVoiceModulation', val)} 
                />
              </div>

              <div className={`space-y-4 pt-4 border-t border-border ${!localConfig.enableVoiceModulation && 'opacity-50 pointer-events-none'}`}>
                <div className="flex justify-between items-center">
                  <Label>Pitch Shift (Semitones)</Label>
                  <span className="text-xs font-mono text-muted-foreground">{localConfig.voicePitchShift}</span>
                </div>
                <Slider 
                  value={[localConfig.voicePitchShift]} 
                  min={-12} max={12} step={1}
                  onValueChange={([val]) => handleChange('voicePitchShift', val)}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
