const express = require('express');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mercadopago = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());

console.log('⏳ Inicializando servidor Finanzap...');
console.log('🛠️  Configurando middlewares: CORS e JSON parser...');

const ACCESS_TOKEN = 'APP_USR-2190858428063851-040509-f8899b0779b8753d85dae14f27892a0d-287816612';
const WEBHOOK_SECRET = '01d71aa758c6c87c2190438452b1dd6d52c06f2975fa56a221f6f324bbfa1482';
const WEBHOOK_URL = 'https://pix-backend-79lq.onrender.com/webhook';

console.log('🔗 Configurando Mercado Pago com access token...');
mercadopago.configure({ access_token: ACCESS_TOKEN });

console.log('📧 Configurando transporte de e-mail...');
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'oficialfinanzap@gmail.com',
    pass: 'hrirzodqitdzwvrb'
  }
});

// Testar conexão com o serviço de e-mail
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Falha na conexão com o serviço de e-mail:', error);
  } else {
    console.log('✅ Serviço de e-mail configurado com sucesso!');
  }
});

const planos = {
  normal: 'instrucoesAssistenteFinanceiro.pdf',
  casal: 'instrucoesassistentefinanceiroplanocasal.pdf',
  familia: 'instrucoes_assistentefinanceiroplanofamilia.pdf'
};

console.log('📂 Planos disponíveis configurados:', JSON.stringify(planos, null, 2));

/**
 * Função aprimorada para enviar PDF por e-mail
 */
async function enviarPDFPorEmail(email, plano) {
  console.log(`\n📨 Iniciando processo de envio de e-mail para ${email}`);
  console.log(`📄 Plano selecionado: ${plano}`);
  
  try {
    console.log('🔍 Verificando existência do plano...');
    if (!planos[plano]) {
      throw new Error(`Plano '${plano}' não encontrado`);
    }

    const pdfPath = path.join(__dirname, planos[plano]);
    console.log(`📂 Caminho do PDF: ${pdfPath}`);

    console.log('🔍 Verificando existência do arquivo PDF...');
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`Arquivo PDF não encontrado: ${pdfPath}`);
    }

    console.log('✉️  Preparando e-mail...');
    const mailOptions = {
      from: 'Finanzap <oficialfinanzap@gmail.com>',
      to: email,
      subject: '📕 Seu Material Finanzap - Acesso ao Conteúdo',
      html: `<div style="font-family: Arial, sans-serif; color: #333;">
              <h1 style="color: #2c3e50;">Seu material está pronto!</h1>
              <p>Olá,</p>
              <p>Obrigado por adquirir o plano <strong>${plano}</strong> do Finanzap!</p>
              <p>Segue em anexo o material completo para você aproveitar ao máximo.</p>
              <p>Qualquer dúvida, responda este e-mail.</p>
              <p style="margin-top: 30px; font-size: 0.9em; color: #7f8c8d;">
                Atenciosamente,<br>Equipe Finanzap
              </p>
            </div>`,
      attachments: [{
        filename: `Finanzap_${plano}.pdf`,
        path: pdfPath,
        contentType: 'application/pdf'
      }]
    };

    console.log('⚡ Enviando e-mail...');
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ E-mail enviado com sucesso!');
    console.log('📫 Detalhes do envio:', {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected
    });

    return info;

  } catch (error) {
    console.error('❌ Erro no envio do e-mail:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

function verifySignature(req, secret) {
  console.log('🔏 Verificando assinatura do webhook...');
  const signature = req.headers['x-mp-signature'] || '';
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  const isValid = signature === hash;
  console.log(`🔐 Assinatura ${isValid ? 'válida' : 'inválida'}`);
  return isValid;
}

app.post('/webhook', async (req, res) => {
  console.log('\n--- 🌐 NOVA REQUISIÇÃO DE WEBHOOK RECEBIDA ---');
  console.log('ℹ️ Tipo de evento:', req.body.type || 'Não especificado');
  
  if (!verifySignature(req, WEBHOOK_SECRET)) {
    console.error('🚨 Erro: Assinatura de webhook inválida');
    return res.status(401).send({ error: 'Assinatura inválida' });
  }

  const event = req.body;
  console.log('📩 Dados do evento:', JSON.stringify({
    type: event.type,
    id: event.id,
    date_created: event.date_created
  }, null, 2));

  if (event.type === 'payment' && event.data?.id) {
    const paymentId = event.data.id;
    console.log(`💳 Processando pagamento ID: ${paymentId}`);

    try {
      console.log('🔍 Buscando detalhes do pagamento no Mercado Pago...');
      const paymentInfo = await mercadopago.payment.get(paymentId);
      console.log('🔄 Status do pagamento:', paymentInfo.body.status);

      if (paymentInfo.body.status === 'approved') {
        const email = paymentInfo.body.payer.email;
        const plano = paymentInfo.body.additional_info.items[0].title.split(' ')[1].toLowerCase();
        console.log(`🎉 Pagamento aprovado para: ${email} | Plano: ${plano}`);

        console.log('📤 Iniciando envio do PDF por e-mail...');
        await enviarPDFPorEmail(email, plano);
        console.log('✔️ Processo de e-mail concluído com sucesso');

        res.status(200).send({ 
          status: 'sucesso', 
          message: 'Pagamento aprovado e e-mail enviado' 
        });

      } else {
        console.log('🕒 Pagamento ainda não aprovado. Status atual:', paymentInfo.body.status);
        res.status(200).send({ 
          status: 'aguardando', 
          message: 'Pagamento ainda não aprovado' 
        });
      }
    } catch (error) {
      console.error('💥 Erro ao processar pagamento:', {
        message: error.message,
        stack: error.stack
      });
      res.status(500).send({ 
        status: 'erro', 
        message: error.message 
      });
    }
  } else {
    console.log('⚡ Evento ignorado - não relacionado a pagamento');
    res.status(200).send({ 
      status: 'evento_ignorado', 
      message: 'Evento não relacionado a pagamento' 
    });
  }
});

app.post('/criar-pagamento', async (req, res) => {
  console.log('\n--- 💸 NOVA SOLICITAÇÃO DE PAGAMENTO ---');
  console.log('📝 Dados recebidos:', JSON.stringify(req.body, null, 2));
  
  const { email, plano } = req.body;
  console.log(`📩 Cliente: ${email} | Plano: ${plano}`);

  const externalReference = uuidv4();
  console.log('🆔 External Reference gerado:', externalReference);

  try {
    console.log('🛒 Criando pagamento no Mercado Pago...');
    const response = await mercadopago.payment.create({
      transaction_amount: 1.00,
      description: `Plano ${plano}`,
      payment_method_id: 'pix',
      notification_url: WEBHOOK_URL,
      external_reference: externalReference,
      payer: { email },
      additional_info: {
        items: [{
          title: `Plano ${plano}`,
          quantity: 1,
          unit_price: 1.00
        }]
      }
    });

    console.log('✅ Pagamento criado com sucesso. Detalhes:', {
      id: response.body.id,
      status: response.body.status,
      qr_code: !!response.body.point_of_interaction
    });

    res.json({
      paymentId: response.body.id,
      qrCode: response.body.point_of_interaction.transaction_data.qr_code,
      qrCodeBase64: response.body.point_of_interaction.transaction_data.qr_code_base64,
      externalReference
    });

  } catch (error) {
    console.error('❌ Erro ao criar pagamento:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data
    });
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data 
    });
  }
});

app.get('/status-pagamento/:paymentId', async (req, res) => {
  const { paymentId } = req.params;
  console.log(`\n🔍 Consultando status do pagamento ID: ${paymentId}`);

  try {
    console.log('🔄 Buscando informações no Mercado Pago...');
    const response = await mercadopago.payment.get(paymentId);
    console.log('ℹ️ Status encontrado:', response.body.status);
    
    res.json({ 
      status: response.body.status,
      last_update: response.body.date_last_updated
    });

  } catch (error) {
    console.error('❌ Erro ao consultar status:', {
      paymentId,
      error: error.message
    });
    res.status(500).json({ 
      error: error.message,
      paymentId 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n========================================');
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🌍 Webhook configurado para: ${WEBHOOK_URL}`);
  console.log('🛡️  Pronto para receber requisições');
  console.log('========================================\n');
});

// Rota de teste para envio de e-mail
app.get('/testar-email/:email/:plano', async (req, res) => {
  console.log('\n--- ✉️  TESTE DE ENVIO DE E-MAIL ---');
  const { email, plano } = req.params;
  console.log(`📧 Testando envio para: ${email} | Plano: ${plano}`);

  try {
    const resultado = await enviarPDFPorEmail(email, plano);
    res.json({
      success: true,
      messageId: resultado.messageId,
      accepted: resultado.accepted
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
