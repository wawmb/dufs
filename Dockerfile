# 选择基本镜像
FROM alpine:latest

# 声明构建函数
ARG TARGETARCH

# 拷贝目录到指定位置
COPY bin /dufs/bin
COPY assets /dufs/assets
COPY configs /dufs/configs

# 设置工作目录
WORKDIR /dufs

# 运行构建前道命令
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.ustc.edu.cn/g' /etc/apk/repositories && \
    # 修改时区为北京时间
    apk update && \
    apk add tzdata && \
    ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" >/etc/timezone && \
    # 获取目标最新版本号
    echo "Architecture: $TARGETARCH" && \
    if [ "$TARGETARCH" = "amd64" ]; then \
        cp /dufs/bin/dufs-linux-amd64* /dufs/dufs; \
    elif [ "$TARGETARCH" = "arm64" ]; then \
        cp /dufs/bin/dufs-linux-arm64* /dufs/dufs; \
    fi && \
    chmod +x dufs && \
    # 删除多余工具以减小镜像
    apk del tzdata && \
    ls -l /dufs/ && \
    ls -l /dufs/bin && \
    ls -l /dufs/assets && \
    ls -l /dufs/configs

# 容器启动时默认命令和参数
ENTRYPOINT ["/dufs/dufs","--config","/dufs/configs/dufs.yaml"]