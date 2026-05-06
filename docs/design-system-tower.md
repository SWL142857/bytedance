# HireLoop 控制塔台设计系统

> Historical visual exploration. Current frontend direction is the full-canvas Virtual Org Console described by `docs/current-state.md` and the public operator guide. Use this file only as archived visual inspiration.

## 设计方向

**核心隐喻**：招聘运营中心 = 机场控制塔台
- 数字员工 = 塔台操作员
- 组织协作 = 指挥中心拓扑
- RAG 证据 = 航线追踪系统

## 色彩系统

```css
:root {
  /* ── 塔台夜空背景 ───────────────────────────────────── */
  --tower-bg-deep:     #0a0e1a;      /* 深夜天空 */
  --tower-bg-mid:      #111827;      /* 中景 */
  --tower-bg-surface:  #1a2234;      /* 控制台表面 */

  /* ── 雷达荧光色 ─────────────────────────────────────── */
  --radar-green:       #00ff88;      /* 主雷达绿 */
  --radar-green-dim:   rgba(0, 255, 136, 0.15);
  --radar-amber:       #ffaa00;      /* 警示琥珀 */
  --radar-amber-dim:   rgba(255, 170, 0, 0.15);
  --radar-cyan:        #00d4ff;      /* 通讯青 */
  --radar-cyan-dim:    rgba(0, 212, 255, 0.15);
  --radar-magenta:     #ff0080;      /* 紧急品红 */
  --radar-magenta-dim: rgba(255, 0, 128, 0.15);

  /* ── 操作员角色色 ───────────────────────────────────── */
  --operator-hr:       #00d4ff;      /* HR Coordinator - 通讯青 */
  --operator-parser:   #00ff88;      /* Resume Parser - 雷达绿 */
  --operator-screen:   #ffaa00;      /* Screening Agent - 琥珀 */
  --operator-interview:#a855f7;      /* Interview Kit - 紫罗兰 */
  --operator-analytics:#f472b6;      /* Analytics - 粉红 */

  /* ── 玻璃控制台 ─────────────────────────────────────── */
  --glass-console:     rgba(20, 30, 50, 0.85);
  --glass-panel:       rgba(30, 45, 70, 0.7);
  --glass-border:      rgba(0, 255, 136, 0.2);
  --glass-glow:        rgba(0, 255, 136, 0.1);

  /* ── 文字层级 ──────────────────────────────────────── */
  --text-bright:       #e2e8f0;
  --text-normal:       #94a3b8;
  --text-dim:          #64748b;
  --text-muted:        #475569;

  /* ── 航线系统 ──────────────────────────────────────── */
  --flight-path:       rgba(0, 212, 255, 0.6);
  --flight-node:       #00ff88;
  --flight-active:     #ffaa00;
  --flight-complete:   #00ff88;
  --flight-pending:    #64748b;
}
```

## 字体系统

```css
:root {
  /* ── 显示字体：等宽终端风 ───────────────────────────── */
  --font-display: "JetBrains Mono", "SF Mono", "Fira Code",
                  ui-monospace, monospace;

  /* ── UI 字体：清晰可读 ──────────────────────────────── */
  --font-ui: "Inter", -apple-system, BlinkMacSystemFont,
             "PingFang SC", "Hiragino Sans GB", sans-serif;

  /* ── 数据字体：等宽数字 ─────────────────────────────── */
  --font-data: "SF Mono", "JetBrains Mono", "Fira Code",
               ui-monospace, monospace;
}
```

## 组件规格

### 1. 数字员工卡片 (Operator Card)

**尺寸**: 280px × 340px
**结构**:
```
┌─────────────────────────────────┐
│  ┌─────┐                        │
│  │ 🎯  │  HR Coordinator        │
│  │ ◉   │  通讯频道 · 就绪       │
│  └─────┘                        │
│                                 │
│  ┌─────────────────────────────┐│
│  │ ▓▓▓▓▓▓▓▓░░░░░░░░  68%      ││
│  │ 处理队列: 12 待办           ││
│  └─────────────────────────────┘│
│                                 │
│  ○ 流程推进 · 任务分配          │
│  ○ 状态更新 · 协调通讯          │
│                                 │
│  [━━━━━━] 最后活动: 2分钟前     │
└─────────────────────────────────┘
```

**视觉特征**:
- 等距视角的塔台窗口剪影
- 操作员图标 + 角色色环
- 实时状态波形动画
- 玻璃质感面板

### 2. 组织拓扑图 (Organization Topology)

**布局**: 中心辐射 + 环形轨道
**结构**:
```
                    ┌──────────┐
                    │Analytics │
                    └────┬─────┘
                         │
    ┌──────────┐    ┌────┴────┐    ┌──────────┐
    │Interview │────│   HR    │────│ Parser   │
    └──────────┘    │Coordinator│   └────┬─────┘
                    └────┬────┘         │
                         │              │
                    ┌────┴────┐         │
                    │Screening│─────────┘
                    └─────────┘

         候选人数据流 →→→ 决策输出
```

**视觉特征**:
- 轨道式连接线
- 数据流动画（粒子沿轨道移动）
- 节点脉冲效果
- 中心控制塔图标

### 3. RAG 航线追踪 (RAG Flight Tracker)

**布局**: 垂直时间线 + 航线节点
**结构**:
```
  查询起飞                        证据降落
     │                              │
     ●──────────────────────────────●
     │                              │
     │    ┌──────────┐              │
     └────│ 节点 1   │──────────────┘
          │ 岗位匹配 │
          └────┬─────┘
               │
          ┌────┴─────┐
          │ 节点 2   │
          │ 技能证据 │
          └────┬─────┘
               │
          ┌────┴─────┐
          │ 节点 3   │
          │ 项目经历 │
          └──────────┘

  ○ 离港        ○ 经停        ● 到港
  (Query)      (Retrieval)   (Evidence)
```

**视觉特征**:
- 航线轨迹动画
- 节点状态指示灯
- 高度/置信度映射
- 飞行进度条

## 动画规格

### 雷达扫描
```css
@keyframes radar-sweep {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
/* 4s 线性循环 */
```

### 数据流粒子
```css
@keyframes particle-flow {
  0% { offset-distance: 0%; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
}
/* 2s 缓动，错开延迟 */
```

### 航线绘制
```css
@keyframes draw-path {
  from { stroke-dashoffset: 1000; }
  to { stroke-dashoffset: 0; }
}
/* 1.5s ease-out */
```

### 脉冲效果
```css
@keyframes pulse-ring {
  0% { transform: scale(1); opacity: 0.8; }
  100% { transform: scale(1.5); opacity: 0; }
}
/* 2s infinite */
```

## 响应式断点

- **Desktop** (≥1440px): 完整三栏布局
- **Laptop** (1024-1439px): 紧凑布局，卡片缩小
- **Tablet** (768-1023px): 单栏堆叠，拓扑简化
- **Mobile** (<768px): 仅显示关键卡片，拓扑隐藏

## 无障碍

- 所有动画支持 `prefers-reduced-motion`
- 色彩对比度符合 WCAG AA
- 键盘导航支持
- ARIA 标签完整
