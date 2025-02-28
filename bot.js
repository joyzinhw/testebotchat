const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const Papa = require('papaparse');
const notifier = require('node-notifier'); // Para notificações
const puppeteer = require('puppeteer-core');

// Caminho correto para o Chromium ou Google Chrome
const executablePath = '/usr/bin/google-chrome'; // Ou outro caminho se necessário

// Configura o cliente do WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './session'
    }),
    chromiumArgs: ['--no-sandbox', '--disable-setuid-sandbox'], // Flags para o Puppeteer
    executablePath: executablePath, // Passa o caminho correto como string
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Tudo certo! WhatsApp conectado.');
});

client.on('disconnected', (reason) => {
    console.log('Cliente desconectado:', reason);
    console.log('Tentando reconectar...');
    client.initialize();
});

client.on('auth_failure', (msg) => {
    console.error('Falha na autenticação:', msg);
    console.log('Tentando reconectar...');
    client.initialize();
});

client.initialize();

const delay = ms => new Promise(res => setTimeout(res, ms));

const userState = {};

// Função para formatar a entrada do usuário
function formatarEntrada(texto) {
    if (!texto) return texto;

    const todoMaiusculo = texto === texto.toUpperCase();
    const todoMinusculo = texto === texto.toLowerCase();

    if (todoMaiusculo || todoMinusculo) {
        return texto.charAt(0).toUpperCase() + texto.slice(1).toLowerCase();
    } else {
        return texto.charAt(0).toUpperCase() + texto.slice(1);
    }
}

// Função para carregar os dados do CSV
function carregarCSV(caminho) {
    try {
        const csv = fs.readFileSync(caminho, 'utf8');
        const data = Papa.parse(csv, { header: true, skipEmptyLines: true }).data;
        console.log(`Dados carregados de ${caminho}:`, data);
        return data;
    } catch (error) {
        console.error(`Erro ao carregar o arquivo CSV: ${caminho}`, error);
        return [];
    }
}

const precos = carregarCSV('precos.csv');
const plantao = carregarCSV('plantao.csv');

if (precos.length === 0 || plantao.length === 0) {
    console.error('Erro: Um ou mais arquivos CSV não foram carregados corretamente.');
    process.exit(1);
}

client.on('message', async msg => {
    const from = msg.from;

    if (from.endsWith('@c.us')) {
        console.log('Mensagem recebida de:', from, 'Conteúdo:', msg.body);

        let contato;
        try {
            contato = await msg.getContact();
        } catch (error) {
            console.error('Erro ao obter contato de:', from, error);
        }

        // Menu de interação com o cliente
        if (userState[from]) {
            const state = userState[from];

            if (state.step === 'nome') {
                await client.sendMessage(from, `Olá ${formatarEntrada(contato.pushname)}! Vamos continuar com o agendamento. Por favor, informe o tipo de consulta.`);
                userState[from].step = 'tipoConsulta';
            } else if (state.step === 'tipoConsulta') {
                // Continue com o agendamento de consulta
                await client.sendMessage(from, `A consulta foi agendada com sucesso para ${msg.body}.`);
                delete userState[from];
            }
        } else {
            await enviarMenu(from, contato.pushname);
        }
    }
});

// Opções do menu
const menuOptions = {
    '1': agendarConsulta,
    '2': async (from) => {
        await client.sendMessage(from, 'Se precisar de algo mais, estou à disposição.');
        notifier.notify({
            title: 'Alerta',
            message: 'Uma pessoa humana precisa responder!',
            sound: true,
            wait: true
        });
    },
    '3': consultarPreco,
    '4': async (from) => {
        const msg = buscarMedicoPlantao();
        await client.sendMessage(from, msg);
    },
    '5': verProcedimentos,
    '6': diasEndoscopia,
    '7': pegarExame,
    '8': async (from) => {
        await client.sendMessage(from, 'Atendimento encerrado. Para retornar, basta enviar uma mensagem.');
        delete userState[from];
    }
};

// Função para consultar preço de um procedimento
async function consultarPreco(from) {
    console.log('Enviando solicitação de preço para:', from);
    await client.sendMessage(from, 'Digite o nome do procedimento que deseja consultar o preço.');

    userState[from] = { step: 'consultarPreco' };
}

// Função para buscar o preço de um procedimento
function buscarPreco(procedimento) {
    const procedimentoNormalizado = procedimento.toLowerCase().trim();
    console.log(`Procedimento buscado: ${procedimentoNormalizado}`);
    const resultados = precos.filter(p => {
        const procedimentoCSV = p.Procedimento.toLowerCase().trim();
        console.log(`Procedimento no CSV: ${procedimentoCSV}`);
        return procedimentoCSV.includes(procedimentoNormalizado);
    });

    if (resultados.length > 0) {
        let resposta = 'Aqui estão os procedimentos que encontrei:\n';
        resultados.forEach(item => {
            resposta += `- ${item.Procedimento}: R$ ${item.Valor}\n`;
        });
        return resposta;
    } else {
        return 'Desculpe, não encontrei nenhum procedimento com esse nome.';
    }
}

// Função para verificar se um procedimento é realizado na clínica
async function verProcedimentos(from) {
    console.log('Solicitando nome do procedimento para:', from);
    await client.sendMessage(from, 'Digite o nome do procedimento que deseja verificar se é realizado na clínica.');

    userState[from] = { step: 'verProcedimento' };
}

// Função para verificar se o procedimento é realizado e retornar o preço
function verificarProcedimento(procedimento) {
    const procedimentoNormalizado = procedimento.toLowerCase().trim();
    console.log(`Procedimento buscado: ${procedimentoNormalizado}`);
    const resultados = precos.filter(p => {
        const procedimentoCSV = p.Procedimento.toLowerCase().trim();
        console.log(`Procedimento no CSV: ${procedimentoCSV}`);
        return procedimentoCSV.includes(procedimentoNormalizado);
    });

    if (resultados.length > 0) {
        let resposta = 'Aqui estão os procedimentos que encontrei:\n';
        resultados.forEach(item => {
            resposta += `- ${item.Procedimento}: R$ ${item.Valor}\n`;
        });
        return resposta;
    } else {
        return `Desculpe, o procedimento *${procedimento}* não é realizado na clínica.`;
    }
}

// Função para enviar o menu principal
async function enviarMenu(from, nome) {
    console.log('Enviando menu para:', from);
    try {
        await client.sendMessage(from, `Olá ${nome}! Sou o assistente virtual do Hospital. Como posso ajudá-lo hoje?  
Opções:  
1) Agendar Consulta  
2) Outras Perguntas  
3) Consultar Preços  
4) Médico de Plantão  
5) Ver Procedimentos  
6) Dias de Endoscopia  
7) Pegar Exame  
8) Finalizar Atendimento`);
    } catch (error) {
        console.error('Erro ao enviar menu para:', from, error);
    }
}

// Função para buscar o médico de plantão
function buscarMedicoPlantao() {
    const agora = new Date();
    const diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    const diaSemana = diasSemana[agora.getDay()];

    const horaAtual = agora.getHours();
    const minutoAtual = agora.getMinutes();
    const minutosAtual = horaAtual * 60 + minutoAtual;

    const medico = plantao.find(p => {
        const [horaInicioStr, horaFimStr] = p.Horário.split('-').map(h => h.trim());
        
        const horaInicio = parseInt(horaInicioStr.split('H')[0]);
        const minutosInicio = horaInicio * 60;

        const horaFim = parseInt(horaFimStr.split('H')[0]);
        const minutosFim = horaFim === 0 ? 24 * 60 : horaFim * 60;

        return p['Dia da Semana'].toLowerCase() === diaSemana &&
               minutosAtual >= minutosInicio && minutosAtual < minutosFim;
    });

    return medico ? `O médico de plantão agora é o ${medico.Médico}.` : 'Não há médicos de plantão no momento.';
}

// Função para agendar consulta
async function agendarConsulta(from) {
    console.log('Iniciando agendamento para:', from);
    userState[from] = { step: 'nome' };
    await client.sendMessage(from, 'Por favor, informe o nome completo do paciente.');
}

// Função para enviar informações sobre endoscopia
async function diasEndoscopia(from) {
    console.log('Enviando informações sobre endoscopia para:', from);
    await client.sendMessage(from, 'Os dias de endoscopia na clínica são agendados diretamente. Os exames começam a partir das 9 horas.');
}

// Função para enviar informações sobre retirada de exame
async function pegarExame(from) {
    console.log('Enviando informações sobre retirada de exame para:', from);
    await client.sendMessage(from, 'Para pegar seu exame, é necessário apresentar o papel entregue após a realização do exame. A retirada pode ser feita a partir das 9 horas do dia indicado no papel.');
}
