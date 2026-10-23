# 工作台逐控件核销盘点（2026-10-23）

## 当前结论

还需核销 **145 个源码控件定义项**：**16 项记录明确未完成，129 项缺少可独立核对的动作与结果证据**。后者不能直接说成“从未测过”。初始盘点后已开始逐项实机核销，新增194项核销，其中185项补齐实机操作证据、5项确认失败控件R35/R36/R37/R39（R38已更正为自动填写假失败）、4项确认当前产品不渲染；详见control-execution-2026-10-23.md。未改产品代码或部署。

旧的313项只是初始提取候选，不是完整分母。本次补充命名导出、备份JSX、全局工作台和PicTransfer，得到812个候选。排除56个重复/非操作节点、22个不渲染或范围排除节点后，当前纳入734项：578项映射已有实机证据，11项映射已测缺陷，145项待核销。

这里的单位是源码控件定义，不是812个屏幕按钮：动态照片行、主题选项、角色组合不按运行时实例倍增。已有记录的操作族映射不是新一轮逐项重测通过证明；已测失败与未测必须分开。11项是映射到这份工作台清单的控件数，不是全部已知产品问题数，客户页及恢复状态机问题仍以本轮问题记录为准。

## 16项明确未完成

- 系统状态：手动容量覆盖3项已于10月23日实测核销，不再列未完成。
- 备份配置：自动备份启用开关1项；计划、保留期与四范围已完成配置持久化核销。
- 全局放映默认：原值保存之外的字段修改和播放回读，14项。
- 项目放映样式：停留时长之外的样式字段，1项（水印缺有效标志素材；顺序与分类两项已确认R39失败，另4项本批完成）。

## 各模块待核销数量

源码文件名用于定位；完整控件、行号和原因见同目录CSV。相邻控件成功不推导取消、关闭、错误重试、未修改字段均通过。窄屏控件没有因“排除真实手机”而被排除。

| 模块 | 待核销项 |
|---|---:|
| `EventInformationCard.tsx` | 8 |
| `SlideshowGlobalDefaultsCard.tsx` | 14 |
| `TransfersPage.tsx` | 12 |
| `ImageSecurityTab.tsx` | 11 |
| `SecurityTab.tsx` | 11 |
| `BrandingPage.tsx` | 3 |
| `BackupConfiguration.tsx` | 6 |
| `SlideshowStyleFields.tsx` | 1 |
| `TransferPhotoPicker.tsx` | 5 |
| `PicpeakBackupCard.tsx` | 4 |
| `PasswordGenerator.tsx` | 5 |
| `CreateEventPage.tsx` | 4 |
| `EventsListPage.tsx` | 4 |
| `SEOTab.tsx` | 4 |
| `BackupHistory.jsx` | 5 |
| `GeneralTab.tsx` | 4 |
| `ConfirmDialog.tsx` | 4 |
| `ErrorBoundary.tsx` | 3 |
| `EventRenameDialog.tsx` | 2 |
| `AdminPhotoGrid.tsx` | 1 |
| `StatusTab.tsx` | 1 |
| `MandatoryPasswordChangeModal.tsx` | 3 |
| `RestoreWizard.jsx` | 2 |
| `AdminLoginPage.tsx` | 2 |
| `ArchivesPage.tsx` | 2 |
| `CMSPage.tsx` | 2 |
| `LocalizedDateInput.tsx` | 0 |
| `ShareLinkCard.tsx` | 2 |
| `PhotoUpload.tsx` | 1 |
| `BackupManagement.tsx` | 1 |
| `GalleryLayoutCard.tsx` | 1 |
| `ColorPickerRow.tsx` | 1 |
| `ColorCustomizationCard.tsx` | 1 |
| `FolderTreeNode.tsx` | 1 |
| `NasFolderSelection.tsx` | 1 |
| `PasswordResetModal.tsx` | 1 |
| `AdminGuestDetail.tsx` | 0 |
| `GuestInviteDialog.tsx` | 0 |
| `EventDetailsHeader.tsx` | 1 |
| `WorkflowRecoveryDialog.tsx` | 1 |
| `EventActionsCard.tsx` | 1 |
| `PhotoFilters.tsx` | 1 |
| `PhotoExportMenu.tsx` | 1 |
| `PhotosTab.tsx` | 1 |
| `RoleManagementTab.tsx` | 1 |
| `WatermarkSourcePicker.tsx` | 1 |
| `SettingsPage.tsx` | 1 |
| `AdminHeader.tsx` | 1 |
| `MaintenanceBanner.tsx` | 1 |
| `AdminLayout.tsx` | 1 |

## 文件

- `workbench-pending-controls-1.0.9.csv`：183条完整待核销明细，编号CTL、源码文件、行号、控件内容和原因。
- `../workbench-control-inventory-1.0.9.json`：812条候选及分类，可逐条复核。
- `../acceptance-round-1.0.9.md`：本轮实机证据及R系列问题。
- `../theme-permission-acceptance-1.0.9.md`：已经完成的主题/权限矩阵及失败结果，不再按未测重复。

下一步按CSV逐项补动作和提交后结果；遇到已有更具体证据先核销，不为补清单重复有效测试。真正实测同项连续两次失败，留证后转项。公开、删除及权限调整继续按具体授权执行。


## R38 / CTL-0374 (2026-10-23)

R38更正：自动填入datetime-local只改变DOM value，未进入React受控状态。真实键盘ArrowUp/ArrowDown后保存2027-01-15T18:30，整页刷新并重开编辑，value/attribute均保留。NAS仍为ad4c807fb5e7。隔离项目ID59，0图、无NAS、未发布；测后关闭预约并保存，保留空草稿。此项为验收自动填写假失败，无需修改产品代码。

Latest control counts: {"已有实机证据": 578, "重复或非操作节点": 56, "需补逐项证据": 129, "记录明确未测": 16, "本轮不计": 22, "已测发现缺陷": 11}; total 812.
