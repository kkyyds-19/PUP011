#### 渠道配置说明

* 不需要用到的渠道，可以关闭掉，提升打包速度，减少冗余文件

* back.json 备份用，防止 channels.json 改残了回退

* 通常只需要改 enable 参数

* 单纯新增 新的channel，无法生效，请联系作者适配新渠道

##### 参数说明

| 参数名 | 类型 | 必填 | 说明 | 默认值 |
|--------|------|------|------|--------|
| `channel` | string | ✓ | 渠道名 | - |
| `enable` | boolean | ✓ | 是否打包这个渠道 | - |
| `s_html_name` | string | ✗ | 打包出来的html的名字 | index.html |
| `b_html_compression` | boolean | ✗ | html资源是否压缩 | false |
| `b_out_zip` | boolean | ✗ | 输出格式是否为zip文件 | false |
| `s_zip_name` | string | ✗ | 输出zip文件名 | index.zip |
| `b_split_res` | boolean | ✗ | 只有zip下生效，true会把资源独立成一个res.js文件 | false |