import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  McpInvocationLogEntry,
  McpServerStatusModel,
  McpToolCategory,
  McpToolCallResult,
  McpToolDefinition,
} from '@forge/shared';
import { McpApi } from '../../../core/api/mcp.api';
import { StudioStateService } from '../../../core/state/studio-state.service';
import { ToastService } from '../../../core/state/toast.service';
import { ButtonComponent } from '../../../ui/button/button.component';
import { CodeViewComponent } from '../../../ui/code-view/code-view.component';
import { IconComponent } from '../../../ui/icon/icon.component';

type ClientSnippetTab = 'ANTIGRAVITY_HTTP' | 'ANTIGRAVITY_STDIO' | 'CLAUDE_CURSOR';

interface SchemaPropertyRow {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly description: string;
  readonly defaultValue: string | null;
  readonly enumValues: string[] | null;
}

@Component({
  selector: 'fs-mcp-page',
  standalone: true,
  imports: [FormsModule, ButtonComponent, CodeViewComponent, IconComponent],
  templateUrl: './mcp-page.component.html',
  styleUrl: './mcp-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class McpPageComponent implements OnInit {
  private readonly mcpApi = inject(McpApi);
  private readonly studio = inject(StudioStateService);
  private readonly toast = inject(ToastService);

  readonly toolName = input<string>();

  readonly status = signal<McpServerStatusModel | null>(null);
  readonly tools = signal<McpToolDefinition[]>([]);
  readonly logs = signal<McpInvocationLogEntry[]>([]);
  readonly loading = signal<boolean>(false);

  readonly categoryFilter = signal<'ALL' | McpToolCategory>('ALL');
  readonly searchQuery = signal<string>('');
  readonly selectedToolName = signal<string>('forge_generate_2d_icon');
  readonly snippetTab = signal<ClientSnippetTab>('ANTIGRAVITY_HTTP');

  readonly argsJsonDraft = signal<string>('');
  readonly invoking = signal<boolean>(false);
  readonly lastResult = signal<McpToolCallResult | null>(null);
  readonly lastDurationMs = signal<number | null>(null);

  readonly categories: ReadonlyArray<{ id: 'ALL' | McpToolCategory; label: string }> = [
    { id: 'ALL', label: 'All Tools' },
    { id: 'GENERATION', label: 'Asset Generators (9)' },
    { id: 'VAULT', label: 'Project & Vault (6)' },
    { id: 'MIDDLEMAN', label: 'Middleman Compiler (2)' },
    { id: 'ASSETS_JOBS', label: 'Assets & Jobs (5)' },
  ];

  readonly filteredTools = computed<McpToolDefinition[]>(() => {
    const cat = this.categoryFilter();
    const q = this.searchQuery().trim().toLowerCase();
    return this.tools().filter((t) => {
      if (cat !== 'ALL' && t.category !== cat) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      );
    });
  });

  readonly selectedTool = computed<McpToolDefinition | null>(() => {
    const name = this.selectedToolName();
    return this.tools().find((t) => t.name === name) ?? this.tools()[0] ?? null;
  });

  readonly schemaProperties = computed<SchemaPropertyRow[]>(() => {
    const tool = this.selectedTool();
    if (!tool) return [];
    const reqSet = new Set(tool.inputSchema.required ?? []);
    const rows: SchemaPropertyRow[] = [];
    for (const [name, prop] of Object.entries(tool.inputSchema.properties)) {
      rows.push({
        name,
        type: prop.type,
        required: reqSet.has(name),
        description: prop.description,
        defaultValue:
          prop.default !== undefined ? JSON.stringify(prop.default) : null,
        enumValues: prop.enum ? prop.enum.map((v) => String(v)) : null,
      });
    }
    return rows;
  });

  readonly clientSnippetCode = computed<string>(() => {
    const tab = this.snippetTab();
    const st = this.status();
    const httpUrl = st?.httpEndpoint ?? 'http://localhost:3333/api/v1/mcp';
    const sseUrl = st?.sseEndpoint ?? 'http://localhost:3333/api/v1/mcp/sse';

    if (tab === 'ANTIGRAVITY_HTTP') {
      return JSON.stringify(
        {
          mcpServers: {
            'forgestudio-control-room': {
              serverUrl: httpUrl,
              sseUrl,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          },
        },
        null,
        2,
      );
    }
    if (tab === 'ANTIGRAVITY_STDIO') {
      return JSON.stringify(
        {
          mcpServers: {
            'forgestudio-control-room': {
              command: st?.stdioCommand ?? 'npm',
              args: st?.stdioArgs ?? ['run', 'mcp:stdio', '-w', '@forge/backend'],
              cwd: 'c:/Dev/WorkflowApp',
            },
          },
        },
        null,
        2,
      );
    }
    return JSON.stringify(
      {
        mcpServers: {
          forgestudio: {
            command: 'node',
            args: ['c:/Dev/WorkflowApp/backend/dist/mcp/mcp-stdio.js'],
          },
        },
      },
      null,
      2,
    );
  });

  async ngOnInit(): Promise<void> {
    await this.refreshAll();
    const routeTool = this.toolName();
    if (routeTool && this.tools().some((t) => t.name === routeTool)) {
      this.selectTool(routeTool);
    } else {
      this.populateDefaultArgs(this.selectedTool());
    }
  }

  async refreshAll(): Promise<void> {
    this.loading.set(true);
    try {
      const [status, toolsList, logsRes] = await Promise.all([
        this.mcpApi.getStatus(),
        this.mcpApi.listTools(),
        this.mcpApi.listLogs(),
      ]);
      this.status.set(status);
      this.tools.set(toolsList);
      this.logs.set(logsRes);
      if (!this.argsJsonDraft().trim() && toolsList.length > 0) {
        const current =
          toolsList.find((t: McpToolDefinition) => t.name === this.selectedToolName()) ??
          toolsList[0] ??
          null;
        this.populateDefaultArgs(current);
      }
    } catch (err) {
      this.toast.error(
        err instanceof Error ? err.message : 'Failed to load MCP server status',
      );
    } finally {
      this.loading.set(false);
    }
  }

  selectTool(name: string): void {
    this.selectedToolName.set(name);
    this.lastResult.set(null);
    this.lastDurationMs.set(null);
    const tool = this.tools().find((t) => t.name === name) ?? null;
    this.populateDefaultArgs(tool);
  }

  loadExamplePreset(): void {
    this.populateDefaultArgs(this.selectedTool());
    this.toast.info(`Loaded sample payload for ${this.selectedToolName()}`);
  }

  copySnippet(): void {
    const code = this.clientSnippetCode();
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(code);
    this.toast.success('Copied MCP client configuration JSON to clipboard');
  }

  copyEndpoint(value: string): void {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(value);
    this.toast.info(`Copied ${value}`);
  }

  async invokeSelectedTool(): Promise<void> {
    const tool = this.selectedTool();
    if (!tool || this.invoking()) return;

    let parsedArgs: Record<string, unknown> = {};
    try {
      const raw = this.argsJsonDraft().trim();
      parsedArgs = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      this.toast.error('Invalid JSON in Tool Arguments editor');
      return;
    }

    this.invoking.set(true);
    const started = performance.now();
    try {
      const res = await this.mcpApi.invokeTool({
        name: tool.name,
        arguments: parsedArgs,
      });
      this.lastResult.set(res);
      this.lastDurationMs.set(Math.round(performance.now() - started));
      const [status, logs] = await Promise.all([
        this.mcpApi.getStatus(),
        this.mcpApi.listLogs(),
      ]);
      this.status.set(status);
      this.logs.set(logs);

      if (res.isError) {
        this.toast.error(`Tool ${tool.name} returned an error`);
      } else {
        this.toast.success(`Executed MCP tool ${tool.name} (${this.lastDurationMs()} ms)`);
      }
    } catch (err) {
      this.toast.error(
        err instanceof Error ? err.message : `Failed to invoke ${tool.name}`,
      );
    } finally {
      this.invoking.set(false);
    }
  }

  loadLogEntryIntoPlayground(entry: McpInvocationLogEntry): void {
    this.selectedToolName.set(entry.toolName);
    this.argsJsonDraft.set(entry.argsSummary);
    this.toast.info(`Loaded invocation arguments for ${entry.toolName}`);
  }

  formatImageDataUri(mimeType: string, data: string): string {
    return `data:${mimeType};base64,${data}`;
  }

  private populateDefaultArgs(tool: McpToolDefinition | null): void {
    if (!tool) return;
    const activeProjectId = this.studio.activeProjectId() ?? undefined;
    const sample = {
      ...tool.sampleArgs,
      ...(activeProjectId && 'projectId' in tool.inputSchema.properties
        ? { projectId: activeProjectId }
        : {}),
    };
    this.argsJsonDraft.set(JSON.stringify(sample, null, 2));
  }
}
