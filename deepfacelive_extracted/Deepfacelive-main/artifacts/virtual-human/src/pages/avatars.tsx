import React, { useState } from "react";
import { Layout } from "@/components/layout";
import { useListAvatars, useActivateAvatar, useDeleteAvatar, useCreateAvatar } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { User, Trash2, CheckCircle, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function Avatars() {
  const { data: avatars, refetch, isLoading } = useListAvatars();
  const activateAvatar = useActivateAvatar();
  const deleteAvatar = useDeleteAvatar();
  const createAvatar = useCreateAvatar();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    skinTone: "Light",
    hairColor: "Black",
    eyeColor: "Brown"
  });

  const handleActivate = (id: number) => {
    activateAvatar.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Avatar activated" });
        refetch();
      }
    });
  };

  const handleDelete = (id: number) => {
    deleteAvatar.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Avatar deleted" });
        refetch();
      }
    });
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createAvatar.mutate({ data: formData }, {
      onSuccess: () => {
        toast({ title: "Avatar created" });
        setIsCreateOpen(false);
        refetch();
        setFormData({
          name: "",
          description: "",
          skinTone: "Light",
          hairColor: "Black",
          eyeColor: "Brown"
        });
      }
    });
  };

  return (
    <Layout>
      <div className="p-8 max-w-6xl mx-auto w-full flex flex-col h-full overflow-y-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold font-mono tracking-tight text-white mb-2">Avatar Gallery</h1>
            <p className="text-muted-foreground">Manage and select your digital personas for live broadcasting.</p>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground font-bold">
                <Plus className="w-4 h-4 mr-2" />
                NEW AVATAR
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border border-border sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle className="font-mono text-xl tracking-tight">Create Avatar Profile</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input 
                    id="name" 
                    value={formData.name} 
                    onChange={(e) => setFormData({...formData, name: e.target.value})} 
                    required 
                    className="bg-black/50"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea 
                    id="description" 
                    value={formData.description} 
                    onChange={(e) => setFormData({...formData, description: e.target.value})} 
                    className="bg-black/50"
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="skinTone">Skin Tone</Label>
                    <Input 
                      id="skinTone" 
                      value={formData.skinTone} 
                      onChange={(e) => setFormData({...formData, skinTone: e.target.value})} 
                      required 
                      className="bg-black/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hairColor">Hair Color</Label>
                    <Input 
                      id="hairColor" 
                      value={formData.hairColor} 
                      onChange={(e) => setFormData({...formData, hairColor: e.target.value})} 
                      required 
                      className="bg-black/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="eyeColor">Eye Color</Label>
                    <Input 
                      id="eyeColor" 
                      value={formData.eyeColor} 
                      onChange={(e) => setFormData({...formData, eyeColor: e.target.value})} 
                      required 
                      className="bg-black/50"
                    />
                  </div>
                </div>
                <div className="pt-4 flex justify-end">
                  <Button type="submit" disabled={createAvatar.isPending} className="font-bold">
                    CREATE AVATAR
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading ? (
            <p className="text-muted-foreground font-mono">Loading avatars...</p>
          ) : avatars?.map((avatar) => (
            <Card 
              key={avatar.id} 
              className={`bg-card border transition-all duration-200 ${
                avatar.isActive 
                  ? "border-primary shadow-[0_0_15px_rgba(0,255,255,0.2)]" 
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="aspect-video bg-black relative border-b border-border flex items-center justify-center overflow-hidden">
                {avatar.imageUrl ? (
                  <img src={avatar.imageUrl} alt={avatar.name} className="w-full h-full object-cover opacity-80" />
                ) : (
                  <User className="w-16 h-16 text-muted-foreground/30" />
                )}
                {avatar.isActive && (
                  <div className="absolute top-3 right-3">
                    <Badge className="bg-primary text-black font-bold text-xs uppercase tracking-widest">
                      <CheckCircle className="w-3 h-3 mr-1 inline" /> Active
                    </Badge>
                  </div>
                )}
              </div>
              <CardContent className="p-5">
                <h3 className="font-bold text-lg mb-1">{avatar.name}</h3>
                <p className="text-sm text-muted-foreground mb-4 line-clamp-2 min-h-[40px]">
                  {avatar.description || "No description provided."}
                </p>
                
                <div className="flex gap-2 text-xs font-mono text-muted-foreground mb-6">
                  <span className="px-2 py-1 bg-black/40 rounded border border-border/50">Skin: {avatar.skinTone}</span>
                  <span className="px-2 py-1 bg-black/40 rounded border border-border/50">Hair: {avatar.hairColor}</span>
                </div>

                <div className="flex gap-2 mt-auto">
                  <Button 
                    variant={avatar.isActive ? "secondary" : "default"}
                    className="flex-1 font-mono uppercase text-xs"
                    disabled={avatar.isActive || activateAvatar.isPending}
                    onClick={() => handleActivate(avatar.id)}
                  >
                    {avatar.isActive ? "Currently Active" : "Activate"}
                  </Button>
                  <Button 
                    variant="destructive" 
                    size="icon"
                    onClick={() => handleDelete(avatar.id)}
                    disabled={avatar.isActive}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}
