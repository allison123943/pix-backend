// Adicione esta função para verificar e carregar os PDFs corretamente
async function carregarPDFs() {
    const pdfErrors = [];
    
    for (const [plano, arquivo] of Object.entries(PLANOS)) {
        const pdfPath = path.join(__dirname, arquivo);
        
        try {
            await fs.promises.access(pdfPath, fs.constants.R_OK);
            const stats = await fs.promises.stat(pdfPath);
            
            if (stats.size === 0) {
                throw new Error('Arquivo PDF vazio');
            }
            
            logger.success(`PDF válido para o plano ${plano}`, {
                path: pdfPath,
                size: `${(stats.size / 1024).toFixed(2)} KB`
            });
        } catch (error) {
            pdfErrors.push({ plano, error: error.message });
            logger.error(`Problema com PDF do plano ${plano}`, error, {
                path: pdfPath
            });
        }
    }
    
    if (pdfErrors.length > 0) {
        throw new Error(`Erros encontrados nos PDFs: ${JSON.stringify(pdfErrors)}`);
    }
}

// Modifique a função de envio de e-mail para garantir o anexo
async function enviarEmailComPDF(email, plano) {
    const maskedEmail = maskData(email);
    logger.info(`Preparando envio para ${maskedEmail}`, { plano });

    try {
        const pdfPath = path.join(__dirname, PLANOS[plano]);
        
        // Verificação robusta do PDF
        await fs.promises.access(pdfPath, fs.constants.R_OK);
        const stats = await fs.promises.stat(pdfPath);
        
        if (stats.size === 0) {
            throw new Error(`Arquivo PDF está vazio (${pdfPath})`);
        }

        logger.debug(`PDF verificado com sucesso`, {
            path: pdfPath,
            size: `${(stats.size / 1024).toFixed(2)} KB`
        });

        const mailOptions = {
            from: `Finanzap <${CONFIG.EMAIL_CONFIG.auth.user}>`,
            to: email,
            subject: '📄 Seu PDF do Finanzap',
            html: `
                <h1>Obrigado por sua compra!</h1>
                <p>Segue em anexo o PDF do seu plano <strong>${plano}</strong>.</p>
                <p>Caso tenha qualquer dúvida, responda este e-mail.</p>
            `,
            attachments: [{
                filename: `Finanzap_${plano}.pdf`,
                path: pdfPath,
                contentType: 'application/pdf'
            }],
            headers: {
                'X-Mailer': 'Finanzap Server',
                'X-Priority': '1'
            }
        };

        const info = await transporter.sendMail(mailOptions);
        logger.success(`E-mail enviado para ${maskedEmail}`, {
            messageId: info.messageId,
            envelope: info.envelope,
            pdfSize: `${(stats.size / 1024).toFixed(2)} KB`
        });

        return true;
    } catch (error) {
        logger.error(`Falha no envio para ${maskedEmail}`, error, {
            plano,
            errorDetails: {
                code: error.code,
                path: error.path,
                syscall: error.syscall
            }
        });
        
        // Tentativa de fallback - enviar sem anexo se o PDF falhar
        try {
            await transporter.sendMail({
                from: CONFIG.EMAIL_CONFIG.auth.user,
                to: email,
                subject: 'Problema com seu PDF do Finanzap',
                text: `Houve um problema ao enviar o PDF do plano ${plano}. Estamos trabalhando para resolver.`
            });
            logger.warn(`E-mail de fallback enviado para ${maskedEmail}`);
        } catch (fallbackError) {
            logger.error(`Falha no fallback para ${maskedEmail}`, fallbackError);
        }
        
        throw error;
    }
}

// Adicione esta verificação durante a inicialização
async function iniciarServidor() {
    try {
        await carregarPDFs();
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            logger.success(`Servidor rodando na porta ${PORT}`, {
                pdfsCarregados: Object.keys(PLANOS).map(plano => ({
                    plano,
                    arquivo: PLANOS[plano],
                    path: path.join(__dirname, PLANOS[plano])
                }))
            });
        });
    } catch (error) {
        logger.error('Falha na inicialização do servidor', error, {
            critical: true,
            pdfs: Object.entries(PLANOS).map(([plano, arquivo]) => ({
                plano,
                arquivo,
                exists: fs.existsSync(path.join(__dirname, arquivo))
            }))
        });
        process.exit(1);
    }
}

// Modifique o webhook para lidar melhor com PDFs
app.post('/webhook', async (req, res) => {
    // ... (código anterior mantido)
    
    if (paymentStatus === 'approved') {
        const pagamento = pagamentosPendentes[externalReference];
        
        if (pagamento) {
            try {
                // Tentativa principal
                await enviarEmailComPDF(pagamento.email, pagamento.plano);
                
                // Verificação de sucesso
                if (pagamentosPendentes[externalReference]) {
                    delete pagamentosPendentes[externalReference];
                    logger.success(`Pagamento concluído e removido da lista`, {
                        externalReference
                    });
                }
            } catch (emailError) {
                // Tentativa alternativa após 5 minutos
                setTimeout(async () => {
                    try {
                        logger.warn(`Tentando reenviar e-mail para ${maskData(pagamento.email)}`);
                        await enviarEmailComPDF(pagamento.email, pagamento.plano);
                    } catch (retryError) {
                        logger.error(`Falha no reenvio para ${maskData(pagamento.email)}`, retryError);
                    }
                }, 300000); // 5 minutos
                
                throw emailError;
            }
        }
    }
    
    // ... (restante do código mantido)
});

// Inicie o servidor
iniciarServidor();
