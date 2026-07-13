"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");

  async function load() {
    const res = await fetch("/api/tasks");
    if (res.ok) {
      const data = await res.json();
      setTasks(data.tasks || []);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!title.trim()) return;
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setTitle("");
    await load();
  }

  async function setStatus(id: string, status: string) {
    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    await load();
  }

  return (
    <div className="p-6 md:p-10 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
        <p className="text-gray-500 text-sm mt-1">CA / clerk assignment queue for the active client</p>
      </div>

      <div className="flex gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" />
        <Button onClick={create}>
          <Plus className="mr-2 h-4 w-4" /> Add
        </Button>
      </div>

      <div className="space-y-2">
        {tasks.map((t) => (
          <div key={t.id} className="border rounded-xl bg-white p-4 flex items-center justify-between shadow-sm">
            <div>
              <div className="font-medium">{t.title}</div>
              <div className="text-xs text-gray-400">{t.status}</div>
            </div>
            <div className="flex gap-2">
              {t.status !== "DONE" && (
                <Button size="sm" variant="outline" onClick={() => setStatus(t.id, "IN_PROGRESS")}>
                  Start
                </Button>
              )}
              {t.status !== "DONE" && (
                <Button size="sm" onClick={() => setStatus(t.id, "DONE")}>
                  Done
                </Button>
              )}
            </div>
          </div>
        ))}
        {tasks.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">No tasks</div>}
      </div>
    </div>
  );
}
