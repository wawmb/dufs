# 选择基本镜像（固定版本，避免每次查 latest 元数据卡住）
FROM alpine:3.20

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
    # 修改时区为北京时间（用 --no-cache 代替 apk update，且保留 tzdata，否则时区软链接会失效）
    apk add --no-cache tzdata && \
    ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" >/etc/timezone && \
    # 获取目标最新版本号
    echo "Architecture: $TARGETARCH" && \
    # 按目标架构选择对应二进制，增加 else 兜底避免 cp 不执行导致后续 chmod 失败
    if [ "$TARGETARCH" = "amd64" ]; then \
        cp /dufs/bin/dufs-linux-amd64* /dufs/dufs; \
    elif [ "$TARGETARCH" = "arm64" ]; then \
        cp /dufs/bin/dufs-linux-arm64* /dufs/dufs; \
    else \
        echo "Unsupported arch: $TARGETARCH" && exit 1; \
    fi && \
    chmod +x dufs && \
    ls -l /dufs/ && \
    ls -l /dufs/bin && \
    ls -l /dufs/assets && \
    ls -l /dufs/configs

# 容器启动时默认命令和参数
ENTRYPOINT ["/dufs/dufs","--config","/dufs/configs/dufs.yaml"]