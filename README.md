# 简介

官网地址：https://github.com/sigoden/dufs

这是一个用 Rust 语言开发的轻量级文件服务器，只需一行命令即可启动，支持文件上传下载、在线预览、权限控制等丰富功能，而且部署极其简单，非常适合团队内部快速搭建文件共享服务。

- 支持拖拽上传文件和文件夹
- 支持在线创建、编辑、搜索文件
- 支持 WebDAV 协议，可与其他工具协同工作
- 支持静态文件服务，可直接浏览和下载文件
- 支持将文件夹打包成 zip 下载
- 支持断点续传，大文件传输更稳定
- 支持直接预览 HTML 网站
- 支持用户认证和访问控制
- 支持 HTTPS 加密传输
- 支持隐藏指定文件和目录

# Dockerfile

本项目是构建 Dufs 的 docker 镜像。

1、docker 目录下执行

``` 
docker buildx build --platform linux/amd64 -t dufs:latest --no-cache --progress=plain .
```

2、push 至 docker hub

```
docker push wawmb/dufs:latest
```

# 运行 docker 容器

```
docker pull wawmb/dufs:latest

docker stop dufs

docker rm dufs

docker run \
    -d --name dufs \
    --restart=always \
    --privileged=true \
    -p 80:80 \
    -v  /data/xspeed/share:/data \
    wawmb/dufs:latest
```