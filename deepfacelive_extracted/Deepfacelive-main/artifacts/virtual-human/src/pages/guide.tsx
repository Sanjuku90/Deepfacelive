import React from "react";
import { Layout } from "@/components/layout";

export default function Guide() {
  return (
    <Layout>
      <div className="p-8 max-w-4xl mx-auto w-full flex flex-col h-full overflow-y-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold font-mono tracking-tight text-white mb-2">OBS Integration Guide</h1>
          <p className="text-muted-foreground">How to pipe your digital avatar into streaming software.</p>
        </div>

        <div className="prose prose-invert prose-cyan max-w-none">
          <p>
            DeepFaceLive acts as an intermediary between your physical webcam and your streaming software. 
            There are two primary methods to route the output canvas into OBS Studio.
          </p>

          <h3 className="font-mono uppercase text-primary mt-8">Method 1: Virtual Camera (Recommended)</h3>
          <p>
            Using a virtual camera plugin provides the lowest latency and best compatibility with software like Discord, Zoom, or OBS.
          </p>
          <ol>
            <li>Install OBS Studio and the Virtual Cam plugin.</li>
            <li>In DeepFaceLive Studio, click the <strong>GO LIVE</strong> button.</li>
            <li>Open OBS Studio. Add a new <strong>Window Capture</strong> source.</li>
            <li>Select the DeepFaceLive browser window.</li>
            <li>Click <strong>Start Virtual Camera</strong> in OBS.</li>
            <li>In your target application (Zoom, Discord), select "OBS Virtual Camera" as your webcam.</li>
          </ol>

          <h3 className="font-mono uppercase text-primary mt-8">Method 2: Browser Source</h3>
          <p>
            If you only need to stream to Twitch/YouTube and don't need the avatar in video calls, you can capture the canvas directly.
          </p>
          <ol>
            <li>In OBS Studio, add a new <strong>Browser</strong> source.</li>
            <li>Set the URL to your DeepFaceLive instance:
              <pre className="bg-black border border-border p-4 rounded-md text-xs font-mono text-emerald-400 mt-2">
                http://localhost:5173/studio?chroma=true
              </pre>
            </li>
            <li>Set width to 1920 and height to 1080.</li>
            <li>Add a Chroma Key filter to the source to remove the background if needed.</li>
          </ol>

          <div className="mt-12 p-6 bg-primary/10 border border-primary/20 rounded-lg">
            <h4 className="text-primary font-mono m-0 mb-2">PRO TIP: Latency Management</h4>
            <p className="text-sm m-0">
              If you experience audio desync, adjust the Sync Offset in OBS Advanced Audio Properties. 
              The face tracking pipeline typically adds ~40-60ms of latency depending on your rendering quality settings.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
