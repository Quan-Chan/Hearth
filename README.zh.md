# Hearth

[English](README.md) | [中文](README.zh.md)

[![CI](https://github.com/Quan-Chan/Hearth/actions/workflows/ci.yml/badge.svg)](https://github.com/Quan-Chan/Hearth/actions/workflows/ci.yml)

**版本 0.1.0（预发布）**

Hearth 是一个事件驱动的模块化框架核心，运行在 Node.js 上，使用 TypeScript 编写。

软件由核心与模块组成。核心的职责：

- 启动模块
- 在模块之间转发事件
- 提供模块共享数据

模块是 YAML 配置与程序文件的组合。YAML 声明模块名、程序文件路径、启动事件与监听事件。

模块之间的协作经三条通道完成：

- 事件广播：纯字符串信号，携带可选内容
- 定向消息：直接投递给指定模块
- 共享对象：公开的对象引用，任何模块可读取与修改

## 快速开始

安装与构建：

```bash
npm install
npm run build
```

命令行启动（读取根目录 hearth.yaml）：

```bash
npm start
```

代码启动与核心选项见使用文档（docs/zh/使用/宿主集成接口.md）。

核心启动时发出 core:startup 事件，声明监听该事件的模块自动启动。模块文件夹中的 YAML 配置被持续监听，新增、修改、删除即时生效。一个模块由 YAML 与程序文件组成，编写示例见使用文档。

## 文档

- 使用文档（模块编写与宿主集成）：docs/zh/使用/
- 实现文档（内部机制与已知问题）：docs/zh/实现/