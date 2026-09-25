// Dynamic gRPC client for the vulcan-host services used by the Vulcan Qwencode extension.
// 本文件实现 Vulcan Qwencode 扩展使用的 vulcan-host 动态 gRPC 客户端。

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { parseJsonObject, readArray, readFiniteNumber, readOptionalString, readPrimitiveArray } from "./json.js";
import type {
  ResolvedVulcanQwencodeConfig,
  VulcanHostAdapterRuntime,
  VulcanHostContext,
  VulcanStatus,
  VulcanVmmChatCompactResponse,
  VulcanVmmDeleteMemoriesResponse,
  VulcanVmmMemorySearchGroupResult,
  VulcanVmmMemorySearchHit,
  VulcanVmmMemorySearchResponse,
  VulcanVmmPostActionResponse,
  VulcanVmmPrecheckResponse,
  VulcanVmmProfileBundleResponse,
  VulcanVmmResolvedProject,
  VulcanVmmResolvedUser,
  VulcanVmmStatus,
  VulcanVmmTurnTimelineItem,
} from "./types.js";

// GrpcUnaryClient is the dynamic service object shape returned by grpc.loadPackageDefinition.
// GrpcUnaryClient 是 grpc.loadPackageDefinition 返回的动态服务对象形态。
type GrpcUnaryClient = Record<
  string,
  (request: Record<string, unknown>, callback: (error: Error | null, response: unknown) => void) => void
>;

// LoadedGrpcServices groups the vulcan-host gRPC service clients used by this extension.
// LoadedGrpcServices 汇总该扩展使用的 vulcan-host gRPC 服务客户端。
interface LoadedGrpcServices {
  hostAdapter: GrpcUnaryClient;
  vmm: GrpcUnaryClient;
}

// PLUGIN_PROTO_DIRECTORY locates the protocol files shipped with this extension.
// PLUGIN_PROTO_DIRECTORY 定位随此扩展一起分发的协议文件目录。
const PLUGIN_PROTO_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../proto/v1");

// DEFAULT_PROTO_CANDIDATES resolves the bundled MCP service contract independently of the caller's working directory.
// DEFAULT_PROTO_CANDIDATES 从插件自带文件解析 MCP 服务协议，不依赖调用方的工作目录。
const DEFAULT_PROTO_CANDIDATES = [path.join(PLUGIN_PROTO_DIRECTORY, "mcp_service.proto")];

// DEFAULT_VMM_PROTO_CANDIDATES resolves the bundled VMM service contract independently of the caller's working directory.
// DEFAULT_VMM_PROTO_CANDIDATES 从插件自带文件解析 VMM 服务协议，不依赖调用方的工作目录。
const DEFAULT_VMM_PROTO_CANDIDATES = [path.join(PLUGIN_PROTO_DIRECTORY, "vmm.proto")];

// DynamicGrpcVulcanHostClient calls the vulcan-host gRPC surface through proto-loader.
// DynamicGrpcVulcanHostClient 通过 proto-loader 调用 vulcan-host gRPC 能力面。
export class DynamicGrpcVulcanHostClient {
  private services?: LoadedGrpcServices;

  // The constructor stores normalized config so service loading stays lazy and cheap.
  // 构造函数保存归一化配置，让服务加载保持惰性且低成本。
  constructor(private readonly config: ResolvedVulcanQwencodeConfig) {}

  // health checks the VMM gRPC health endpoint.
  // health 检查 VMM gRPC 健康端点。
  async health(): Promise<VulcanStatus> {
    const response = await this.callUnary<Record<string, unknown>>(this.loadServices().vmm, "Healthz", {});
    return {
      ok: response.status === "ok",
      message: String(response.status ?? "unknown"),
      version: readOptionalString(response.version),
      protocolVersion: readOptionalString(response.protocolVersion),
    };
  }

  // getVmmStatus asks HostAdapterService whether VMM-dependent features are enabled.
  // getVmmStatus 通过 HostAdapterService 查询 VMM 相关能力是否启用。
  async getVmmStatus(context: VulcanHostContext): Promise<VulcanVmmStatus> {
    const response = await this.callUnary<Record<string, unknown>>(this.loadServices().hostAdapter, "GetVmmStatus", {
      context: toHostAdapterClientContext(context),
    });
    return {
      enabled: response.vmmEnabled === true,
      status: String(response.vmmStatus ?? response.message ?? ""),
      isError: response.isError === true,
      message: readOptionalString(response.message),
    };
  }

  // buildHostAdapterRuntime asks HostAdapterService to normalize session/workmem context for one call.
  // buildHostAdapterRuntime 请求 HostAdapterService 为单次调用归一化 session/workmem 上下文。
  async buildHostAdapterRuntime(context: VulcanHostContext): Promise<VulcanHostAdapterRuntime> {
    const response = await this.callUnary<Record<string, unknown>>(this.loadServices().hostAdapter, "BuildHostAdapterRuntime", {
      context: toHostAdapterClientContext(context),
      hostKind: context.hostKind,
      sessionId: context.sessionId ?? context.sessionKey ?? "",
      turnId: context.turnId ?? "",
      workspace: context.workspaceDir ?? "",
      userMessage: context.userMessage ?? "",
      conversationId: context.conversationId ?? "",
      rootSessionId: context.rootSessionId ?? "",
    });
    return {
      hostKind: String(response.hostKind ?? context.hostKind),
      sessionId: readOptionalString(response.sessionId),
      workmemId: readOptionalString(response.workmemId),
      workmemSource: readOptionalString(response.workmemSource),
      identityReady: response.identityReady === true,
      degradedReasons: Array.isArray(response.degradedReasons)
        ? response.degradedReasons
            .filter(
              (entry): entry is string => typeof entry === "string" && Boolean(entry.trim()),
            )
            .map((entry) => entry.trim())
        : [],
      isError: response.isError === true,
      message: readOptionalString(response.message),
      vmmEnabled: response.vmmEnabled === true,
      vmmStatus: String(response.vmmStatus ?? ""),
      runtime: parseJsonObject(readOptionalString(response.runtimeJson)),
    };
  }

  // resolveVmmProject resolves one existing VMM project by numeric id or canonical display path without creating anything.
  // resolveVmmProject 按数字 ID 或标准展示路径解析一条现有 VMM 项目，且不会触发创建。
  async resolveVmmProject(params: { context: VulcanHostContext; projectRef: string }): Promise<VulcanVmmResolvedProject> {
    const response = await this.callUnary<Record<string, unknown>>(this.loadServices().vmm, "ResolveProject", {
      projectRef: params.projectRef,
    });
    const project = asRecord(response.project);
    return {
      projectId: String(project.projectId ?? ""),
      teamName: String(project.teamName ?? ""),
      spaceName: String(project.spaceName ?? ""),
      projectName: String(project.projectName ?? ""),
      displayPath: String(project.displayPath ?? params.projectRef),
      message: String(response.message ?? ""),
      exists: Boolean(project.projectId),
      needsConfirm: false,
      createdTeam: false,
      createdSpace: false,
      createdProject: false,
    };
  }

  // resolveVmmUser resolves or creates one stable VMM user row for the current host context.
  // resolveVmmUser 为当前宿主上下文解析或创建一条稳定的 VMM 用户记录。
  async resolveVmmUser(params: {
    context: VulcanHostContext;
    userRef: string;
    confirmCreate?: boolean | undefined;
  }): Promise<VulcanVmmResolvedUser> {
    const response = await this.callUnary<Record<string, unknown>>(this.loadServices().vmm, "ResolveUser", {
      userRef: params.userRef,
      confirmCreate: params.confirmCreate === true,
    });
    const user = asRecord(response.user);
    return {
      userId: String(user.userId ?? ""),
      userName: String(user.userName ?? ""),
      message: String(response.message ?? ""),
      created: response.created === true,
      exists: response.exists === true,
    };
  }

  // searchVmmMemories performs grouped memory search against the VMM data plane.
  // searchVmmMemories 对 VMM 数据面执行分组记忆检索。
  async searchVmmMemories(params: {
    context: VulcanHostContext;
    userId: string;
    projectId: string;
    queries: string[];
    topK: number;
  }): Promise<VulcanVmmMemorySearchResponse> {
    const response = await this.callUnary<Record<string, unknown>>(this.loadServices().vmm, "SearchMemoryEvents", {
      userId: params.userId,
      projectId: params.projectId,
      queries: params.queries,
      topK: params.topK,
    });
    return {
      results: readArray(response.results).map((entry) => normalizeVmmMemorySearchGroup(entry)),
      traceId: readOptionalString(response.traceId),
    };
  }

  // deleteVmmMemories deletes explicit durable memory ids inside the resolved VMM scope.
  // deleteVmmMemories 会在已解析 VMM 范围内删除明确指定的长期 memory id。
  async deleteVmmMemories(params: {
    context: VulcanHostContext;
    userId: string;
    projectId: string;
    memoryIds: string[];
    reason: string;
  }): Promise<VulcanVmmDeleteMemoriesResponse> {
    const response = await this.callUnary<Record<string, unknown>>(this.loadServices().vmm, "DeleteMemories", {
      userId: params.userId,
      projectId: params.projectId,
      memoryIds: params.memoryIds,
      reason: params.reason,
    });
    return {
      deletedMemoryIds: readPrimitiveArray(response.deletedMemoryIds).map(String),
      notFoundMemoryIds: readPrimitiveArray(response.notFoundMemoryIds).map(String),
      deletedVectorRows: String(response.deletedVectorRows ?? "0"),
      traceId: readOptionalString(response.traceId),
    };
  }

  // getVmmProfileBundle loads the VMM-owned hidden full profile bundle for one resolved user/project scope.
  // getVmmProfileBundle 加载 VMM 为一组已解析 user/project 作用域组装的隐藏完整画像 bundle。
  async getVmmProfileBundle(params: {
    context: VulcanHostContext;
    userId: string;
    projectId: string;
    includeExplanation?: boolean | undefined;
  }): Promise<VulcanVmmProfileBundleResponse> {
    const response = await this.callUnary<Record<string, unknown>>(this.loadServices().vmm, "GetProfileBundle", {
      userId: params.userId,
      projectId: params.projectId,
      mode: "PROFILE_BUNDLE_MODE_FULL",
      includeExplanation: params.includeExplanation !== false,
    });
    return {
      combinedText: String(response.combinedText ?? ""),
      explanationText: readOptionalString(response.explanationText),
      environmentPriorityText: readOptionalString(response.environmentPriorityText),
      teamProfile: readOptionalString(response.teamProfile),
      spaceProfile: readOptionalString(response.spaceProfile),
      projectProfile: readOptionalString(response.projectProfile),
      userProfile: readOptionalString(response.userProfile),
      traceId: readOptionalString(response.traceId),
    };
  }

  // preCheckVmm asks VMM to assemble compact recall context for one upcoming turn.
  // preCheckVmm 请求 VMM 为即将开始的一轮组装紧凑召回上下文。
  async preCheckVmm(params: {
    context: VulcanHostContext;
    sessionId: string;
    userId: string;
    projectId: string;
    userContent: string;
    recallMode?: "legacy" | "session_compact" | undefined;
  }): Promise<VulcanVmmPrecheckResponse> {
    const response = await this.callUnary<Record<string, unknown>>(this.loadServices().vmm, "PreCheck", {
      sessionId: params.sessionId,
      userId: params.userId,
      projectId: params.projectId,
      userContent: params.userContent,
      recallMode:
        params.recallMode === "legacy"
          ? "PRE_CHECK_RECALL_MODE_LEGACY"
          : "PRE_CHECK_RECALL_MODE_SESSION_COMPACT",
    });
    return {
      shouldInject: response.shouldInject === true,
      degraded: response.degraded === true,
      contextItems: readArray(response.contextItems).map((entry) => ({
        text: String(entry.text ?? ""),
        score: readFiniteNumber(entry.score, 0),
        turnId: String(entry.turnId ?? ""),
        hasDialogue: entry.hasDialogue === true,
        createdDatetime: String(entry.createdDatetime ?? ""),
        memoryId: String(entry.memoryId ?? ""),
      })),
      traceId: readOptionalString(response.traceId),
    };
  }

  // postActionVmm appends one durable text-only turn payload into VMM's postaction chain.
  // postActionVmm 将一条纯文本回合载荷追加到 VMM 的 postaction 链路。
  async postActionVmm(params: {
    context: VulcanHostContext;
    sessionId: string;
    userId: string;
    projectId: string;
    userContent: string;
    assistantContent: string;
    timeline: VulcanVmmTurnTimelineItem[];
  }): Promise<VulcanVmmPostActionResponse> {
    const response = await this.callUnary<Record<string, unknown>>(this.loadServices().vmm, "PostAction", {
      sessionId: params.sessionId,
      userId: params.userId,
      projectId: params.projectId,
      userContent: params.userContent,
      assistantContent: params.assistantContent,
      timeline: params.timeline.map((entry) => ({ type: entry.type, content: entry.content })),
    });
    return {
      accepted: response.accepted === true,
      traceId: readOptionalString(response.traceId),
    };
  }

  // chatCompactVmm acknowledges one Qwen compaction boundary so later VMM recall can reopen only compacted-away history.
  // chatCompactVmm 确认一次 Qwen 压缩边界，让后续 VMM 召回只重新开放已被压缩的历史。
  async chatCompactVmm(params: {
    context: VulcanHostContext;
    sessionId: string;
    userId: string;
    projectId: string;
  }): Promise<VulcanVmmChatCompactResponse> {
    const response = await this.callUnary<Record<string, unknown>>(this.loadServices().vmm, "ChatCompact", {
      sessionId: params.sessionId,
      userId: params.userId,
      projectId: params.projectId,
    });
    return {
      accepted: response.accepted === true,
      updated: response.updated === true,
      compactedTurnId: readOptionalString(response.compactedTurnId),
      traceId: readOptionalString(response.traceId),
    };
  }

  // callUnary wraps callback-style grpc-js calls into promises.
  // callUnary 将 callback 风格的 grpc-js 调用包装为 Promise。
  private async callUnary<T>(
    client: GrpcUnaryClient,
    method: string,
    request: Record<string, unknown>,
  ): Promise<T> {
    const fn = client[method];
    if (typeof fn !== "function") {
      throw new Error(`vulcan-host gRPC method not found: ${method}`);
    }
    return await new Promise<T>((resolve, reject) => {
      fn.call(client, request, (error, response) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(response as T);
      });
    });
  }

  // loadServices loads proto definitions once and creates gRPC clients for each service.
  // loadServices 只加载一次 proto 定义，并为每个服务创建 gRPC 客户端。
  private loadServices(): LoadedGrpcServices {
    if (this.services) {
      return this.services;
    }
    const mcpProtoPath = resolveProtoPath(this.config);
    const vmmProtoPath = resolveVmmProtoPath(this.config, mcpProtoPath);
    const includeDirs = [...new Set([path.dirname(mcpProtoPath), path.dirname(vmmProtoPath)])];
    const packageDefinition = protoLoader.loadSync([mcpProtoPath, vmmProtoPath], {
      defaults: true,
      enums: String,
      includeDirs,
      keepCase: false,
      longs: String,
      oneofs: true,
    });
    const loaded = grpc.loadPackageDefinition(packageDefinition) as Record<string, unknown>;
    const namespace = (((loaded.vulcan as Record<string, unknown>)?.mcp as Record<string, unknown>)?.v1 ??
      {}) as Record<string, unknown>;
    const HostAdapterService = namespace.HostAdapterService as
      | (new (target: string, credentials: grpc.ChannelCredentials) => GrpcUnaryClient)
      | undefined;
    const vmmNamespace = ((loaded.vmm as Record<string, unknown>)?.v1 ?? {}) as Record<string, unknown>;
    const VMMService = vmmNamespace.VMMService as
      | (new (target: string, credentials: grpc.ChannelCredentials) => GrpcUnaryClient)
      | undefined;
    if (!HostAdapterService || !VMMService) {
      throw new Error("vulcan-host proto does not expose HostAdapterService and VMMService.");
    }
    const endpoint = normalizeGrpcEndpoint(this.config.endpoint);
    const credentials = grpc.credentials.createInsecure();
    this.services = {
      hostAdapter: new HostAdapterService(endpoint, credentials),
      vmm: new VMMService(endpoint, credentials),
    };
    return this.services;
  }
}

// createVulcanHostClient constructs the shared client used by hooks and diagnostics.
// createVulcanHostClient 创建 hooks 与诊断逻辑共用的客户端。
export function createVulcanHostClient(config: ResolvedVulcanQwencodeConfig): DynamicGrpcVulcanHostClient {
  return new DynamicGrpcVulcanHostClient(config);
}

// resolveProtoPath resolves the proto path from config, environment, or the bundled protocol file.
// resolveProtoPath 从配置、环境变量或插件自带的协议文件解析 proto 路径。
function resolveProtoPath(config: ResolvedVulcanQwencodeConfig): string {
  const candidates = [config.protoPath, ...DEFAULT_PROTO_CANDIDATES].filter(Boolean) as string[];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      "Bundled mcp_service.proto was not found. Reinstall the complete extension or set VULCAN_HOST_PROTO_PATH / config protoPath.",
    );
  }
  return found;
}

// resolveVmmProtoPath resolves the configured or bundled VMM protocol file.
// resolveVmmProtoPath 解析用户配置或插件自带的 VMM 协议文件。
function resolveVmmProtoPath(config: ResolvedVulcanQwencodeConfig, mcpProtoPath: string): string {
  const sibling = path.join(path.dirname(mcpProtoPath), "vmm.proto");
  const configured =
    config.protoPath && config.protoPath.endsWith("vmm.proto")
      ? config.protoPath
      : config.protoPath
        ? path.join(path.dirname(config.protoPath), "vmm.proto")
        : undefined;
  const candidates = [configured, sibling, ...DEFAULT_VMM_PROTO_CANDIDATES].filter(Boolean) as string[];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      "Bundled vmm.proto was not found. Reinstall the complete extension or place vmm.proto next to the configured mcp_service.proto.",
    );
  }
  return found;
}

// normalizeGrpcEndpoint removes URL schemes because grpc-js expects host:port targets.
// normalizeGrpcEndpoint 移除 URL scheme，因为 grpc-js 需要 host:port 目标。
function normalizeGrpcEndpoint(endpoint: string): string {
  return endpoint.replace(/^https?:\/\//u, "");
}

// toHostAdapterClientContext converts trusted host context into HostAdapter gRPC context fields.
// toHostAdapterClientContext 将受信任宿主上下文转换为 HostAdapter gRPC context 字段。
function toHostAdapterClientContext(context: VulcanHostContext): Record<string, unknown> {
  return {
    clientName: context.clientName,
    clientVersion: context.clientVersion,
    requestId: context.requestId,
  };
}

// normalizeVmmMemorySearchGroup maps one dynamic protobuf group into the stable shared result shape.
// normalizeVmmMemorySearchGroup 将一条动态 protobuf 分组映射为稳定的共享结果结构。
function normalizeVmmMemorySearchGroup(entry: Record<string, unknown>): VulcanVmmMemorySearchGroupResult {
  return {
    queryIndex: readFiniteNumber(entry.queryIndex, 0),
    query: String(entry.query ?? ""),
    hits: readArray(entry.hits).map((hit) => normalizeVmmMemorySearchHit(hit)),
  };
}

// normalizeVmmMemorySearchHit maps one dynamic protobuf hit into the stable shared hit shape.
// normalizeVmmMemorySearchHit 将一条动态 protobuf 命中映射为稳定的共享命中结构。
function normalizeVmmMemorySearchHit(entry: Record<string, unknown>): VulcanVmmMemorySearchHit {
  return {
    memoryId: String(entry.memoryId ?? ""),
    sourceTurnId: String(entry.sourceTurnId ?? ""),
    abstract: String(entry.abstract ?? ""),
    detailsPreview: String(entry.detailsPreview ?? ""),
    category: String(entry.category ?? ""),
    createdDatetime: String(entry.createdDatetime ?? ""),
  };
}

// asRecord safely narrows unknown protobuf-decoded values into one plain object shell.
// asRecord 将未知的 protobuf 解码值安全收窄为普通对象外壳。
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
